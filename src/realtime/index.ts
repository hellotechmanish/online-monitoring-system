/**
 * DERMS realtime service (run with `npm run start:realtime` / `npm run dev:realtime`).
 *
 * The ONLY process that subscribes to MQTT, holds the latest-value cache, serves
 * WebSocket clients and runs the persistence worker. Run exactly one instance.
 *
 *   MQTT → validate envelope → verify Node (MongoDB) → decode/parse → cache
 *        → WebSocket (authorized, per-Node, per-sensor) → browser chart
 *   cache → PersistenceWorker (GlobalSetting.databaseSaveIntervalSeconds) → MongoDB
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

import { Types } from "mongoose";
import { connectDB, disconnectDB } from "@/lib/db";
import { GlobalSetting, Node, SensorReading } from "@/lib/models";
import { normalizeSettings, type AppSettings } from "@/lib/settings";
import { verifyWsToken } from "@/lib/auth/tokens";
import { loadUserForClaims } from "@/lib/auth/user-loader";
import {
  sensorTypeOf,
  type SensorConfigLike,
  type SensorType,
} from "@/lib/protocol/sensors";
import type { PayloadEncoding } from "@/lib/protocol/decode";
import { logger, errInfo } from "@/lib/logger";
import { NodeRegistry, type RegisteredNode } from "./node-registry";
import { LiveCache } from "./live-cache";
import {
  PersistenceWorker,
  isOnlyDuplicateKeyError,
  type HistoryMode,
} from "./persistence";
import { SubscriptionHub } from "./subscriptions";
import { Ingestor } from "./ingest";
import { ActivityTracker } from "./activity";
import { startWsServer } from "./ws-server";
import { startMqtt, redactUrl } from "./mqtt-client";

const log = logger("realtime");

const g = globalThis as unknown as { __dermsRealtimeStarted?: boolean };

async function loadSettings(): Promise<AppSettings> {
  const doc = await GlobalSetting.findOne({ key: "global" }).lean();
  return normalizeSettings(doc as Partial<AppSettings> | null);
}

async function loadNode(nodeId: number): Promise<RegisteredNode | null> {
  const n = await Node.findOne({ nodeId })
    .select("nodeId siteId sensors discoveredSensors")
    .lean();
  if (!n) return null;
  const sensors = (n.sensors ?? []) as unknown as SensorConfigLike[];
  return {
    _id: n._id.toString(),
    nodeId: n.nodeId,
    siteId: n.siteId.toString(),
    sensors,
    sensorTypes: new Set(sensors.map((s) => s.sensorType as SensorType)),
    discovered: new Set((n.discoveredSensors ?? []).map((d) => d.sensorId)),
  };
}

function allowedOrigins(): string[] {
  const out = new Set<string>();
  for (const raw of [
    process.env.APP_URL,
    ...(process.env.REALTIME_ALLOWED_ORIGINS ?? "").split(","),
  ]) {
    if (!raw?.trim()) continue;
    try {
      out.add(new URL(raw.trim()).origin);
    } catch {
      log.warn("Ignoring invalid origin in configuration");
    }
  }
  return Array.from(out);
}

async function main() {
  if (g.__dermsRealtimeStarted) {
    log.warn(
      "Realtime service already started in this process; ignoring duplicate start",
    );
    return;
  }
  g.__dermsRealtimeStarted = true;

  await connectDB();
  let settings = await loadSettings();
  // After a restart nothing is known to be live: Nodes go online again on their first message.
  await Node.updateMany({ status: "online" }, { $set: { status: "offline" } });

  const mode: HistoryMode =
    process.env.READING_HISTORY_MODE === "raw" ? "raw" : "snapshot";
  const encoding = (
    ["auto", "base64", "json"].includes(process.env.MQTT_PAYLOAD_ENCODING ?? "")
      ? process.env.MQTT_PAYLOAD_ENCODING
      : "auto"
  ) as PayloadEncoding;

  const cache = new LiveCache();
  const registry = new NodeRegistry(loadNode, 30_000);

  const worker = new PersistenceWorker(
    async (docs) => {
      try {
        await SensorReading.insertMany(docs, { ordered: false });
      } catch (e) {
        if (!isOnlyDuplicateKeyError(e)) throw e; // duplicates = already stored by a previous attempt
      }
    },
    {
      intervalSeconds: settings.databaseSaveIntervalSeconds,
      mode,
      onError: (e, pending) =>
        log.error("Persisting readings failed; will retry", {
          ...errInfo(e),
          pending,
        }),
    },
  );
  worker.start();
  log.info("Persistence worker started", {
    mode,
    intervalSeconds: worker.getIntervalSeconds(),
  });

  const hub = new SubscriptionHub(
    {
      loadUser: (id, sv) => loadUserForClaims(id, sv),
      findNode: async (nodeId) => {
        const n = await Node.findOne({ nodeId })
          .select("nodeId siteId sensors")
          .lean();
        return n
          ? {
              nodeId: n.nodeId,
              siteId: n.siteId.toString(),
              sensors: n.sensors as unknown as SensorConfigLike[],
            }
          : null;
      },
      latest: (nodeId, sensors) => cache.get(nodeId, sensors),
    },
    { liveEnabled: settings.liveChart.enabled },
  );

  const activity = new ActivityTracker(
    {
      markOnline: async (updates) => {
        await Node.bulkWrite(
          updates.map((u) => ({
            updateOne: {
              filter: { _id: new Types.ObjectId(u.nodeRef) },
              update: {
                $set: { status: "online", lastReadingAt: u.lastReadingAt },
              },
            },
          })),
          { ordered: false },
        );
      },
      markOffline: async (refs) => {
        await Node.updateMany(
          { _id: { $in: refs.map((r) => new Types.ObjectId(r)) } },
          { $set: { status: "offline" } },
        );
      },
      addDiscovered: async (nodeRef, sensorId, sensorType, at) => {
        await Node.updateOne(
          {
            _id: new Types.ObjectId(nodeRef),
            "discoveredSensors.sensorId": { $ne: sensorId },
          },
          {
            $push: {
              discoveredSensors: { sensorId, sensorType, firstSeenAt: at },
            },
          },
        );
      },
    },
    Math.max(10, Number(process.env.NODE_OFFLINE_AFTER_SECONDS) || 120) * 1000,
    Date.now,
    (e) => log.warn("Node activity update failed", errInfo(e)),
  );
  activity.start(15_000);

  const ingestor = new Ingestor({
    registry,
    cache,
    hub,
    worker,
    encoding,
    onActivity: (node, at) => activity.touch(node._id, at),
    onDiscovered: (node, sensorId, at) => {
      log.info("New sensor channel discovered", {
        nodeId: node.nodeId,
        sensorId,
      });
      void activity.discovered(
        node._id,
        sensorId,
        sensorTypeOf(sensorId) ?? "UNKNOWN",
        at,
      );
    },
    log,
  });

  const port = Number(process.env.REALTIME_PORT) || 3001;
  const ws = startWsServer({
    port,
    hub,
    allowedOrigins: allowedOrigins(),
    authenticate: async (token) => {
      const claims = await verifyWsToken(token);
      if (!claims) return null;
      const user = await loadUserForClaims(claims.sub, claims.sv);
      return user ? { user, sv: claims.sv, jti: claims.jti } : null;
    },
    health: () => ({
      mqtt: hub.status().mqtt,
      liveEnabled: hub.status().liveEnabled,
      clients: hub.clientCount(),
      pendingReadings: worker.pendingCount(),
      historyMode: worker.mode,
      saveIntervalSeconds: worker.getIntervalSeconds(),
      ingest: ingestor.stats,
    }),
    log,
  });

  let mqttHandle: ReturnType<typeof startMqtt> | null = null;
  const mqttUrl = process.env.MQTT_URL?.trim();
  const topic = process.env.MQTT_TOPIC?.trim() || "b25saW5lcmVzbW9uaXRvcg==";
  if (!mqttUrl) {
    hub.setMqttStatus("disabled");
    log.warn(
      "MQTT_URL is not set: live data is disabled (CRM and history still work)",
    );
  } else {
    log.info("Starting MQTT subscriber", {
      broker: redactUrl(mqttUrl),
      topic,
      encoding,
    });
    mqttHandle = startMqtt({
      url: mqttUrl,
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      topic,
      onMessage: (payload) => {
        ingestor
          .handle(payload)
          .catch((e) => log.error("Ingest failed", errInfo(e)));
      },
      onStatus: (s) => hub.setMqttStatus(s),
      log,
    });
  }

  // Apply GlobalSetting changes without restart (polling works without a replica set).
  const settingsTimer = setInterval(
    async () => {
      try {
        const next = await loadSettings();
        if (
          next.databaseSaveIntervalSeconds !==
          settings.databaseSaveIntervalSeconds
        ) {
          worker.setIntervalSeconds(next.databaseSaveIntervalSeconds);
          log.info("Applied new database save interval", {
            seconds: worker.getIntervalSeconds(),
          });
        }
        if (next.liveChart.enabled !== settings.liveChart.enabled) {
          hub.setLiveEnabled(next.liveChart.enabled);
          log.info("Live chart delivery toggled", {
            enabled: next.liveChart.enabled,
          });
        }
        settings = next;
      } catch (e) {
        log.warn("Settings refresh failed", errInfo(e));
      }
    },
    Math.max(2, Number(process.env.SETTINGS_POLL_SECONDS) || 10) * 1000,
  );
  settingsTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Shutting down realtime service", { signal });
    clearInterval(settingsTimer);
    try {
      await mqttHandle?.stop();
      worker.stop();
      const res = await Promise.race([
        worker.flush(),
        new Promise<{ written: number; failed: number; skipped: number }>((r) =>
          setTimeout(() => r({ written: 0, failed: -1, skipped: 0 }), 5000),
        ),
      ]);
      log.info("Final flush", { ...res });
      activity.stop();
      await activity.drain();
      await activity.tick();
      await ws.close();
      await disconnectDB();
    } catch (e) {
      log.error("Error during shutdown", errInfo(e));
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  log.error("Realtime service failed to start", errInfo(e));
  process.exit(1);
});
