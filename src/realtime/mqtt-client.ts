import mqtt, { type MqttClient } from "mqtt";
import { randomBytes } from "node:crypto";
import type { MqttStatus } from "./subscriptions";

export interface MqttOptions {
  url: string;
  username?: string;
  password?: string;
  topic: string;
  onMessage(payload: Buffer, topic: string): void;
  onStatus(s: MqttStatus): void;
  log: { info: (m: string, meta?: Record<string, unknown>) => void; warn: (m: string, meta?: Record<string, unknown>) => void };
}

/** Redacts credentials from a broker URL for logging. */
export function redactUrl(u: string): string {
  try {
    const url = new URL(u);
    if (url.password) url.password = "***";
    if (url.username) url.username = "***";
    return url.toString();
  } catch {
    return "<invalid url>";
  }
}

/**
 * The single MQTT subscriber of the system. Reconnects automatically with
 * bounded exponential backoff (1 s → 30 s). Credentials stay server-side.
 */
export function startMqtt(o: MqttOptions): { client: MqttClient; stop(): Promise<void> } {
  let backoff = 1000;
  o.onStatus("connecting");
  const client = mqtt.connect(o.url, {
    username: o.username || undefined,
    password: o.password || undefined,
    clientId: `derms-realtime-${randomBytes(4).toString("hex")}`,
    clean: true,
    reconnectPeriod: backoff,
    connectTimeout: 10_000,
    keepalive: 30,
  });
  client.on("connect", () => {
    backoff = 1000;
    client.options.reconnectPeriod = backoff;
    o.log.info("MQTT connected", { broker: redactUrl(o.url) });
    client.subscribe(o.topic, { qos: 1 }, (err) => {
      if (err) o.log.warn("MQTT subscribe failed", { topic: o.topic, error: err.message });
      else o.log.info("MQTT subscribed", { topic: o.topic });
    });
    o.onStatus("connected");
  });
  client.on("reconnect", () => {
    backoff = Math.min(backoff * 2, 30_000);
    client.options.reconnectPeriod = backoff;
    o.onStatus("reconnecting");
  });
  client.on("close", () => o.onStatus("disconnected"));
  client.on("offline", () => o.onStatus("disconnected"));
  client.on("error", (e) => o.log.warn("MQTT error", { error: e.message }));
  client.on("message", (topic, payload) => {
    if (topic === o.topic) o.onMessage(payload, topic);
  });
  return {
    client,
    stop: () => new Promise<void>((r) => client.end(false, {}, () => r())),
  };
}
