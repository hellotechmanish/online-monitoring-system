import { decodeEnvelope, DecodeError, parsePayload, type PayloadEncoding } from "@/lib/protocol/decode";
import { sensorTypeOf } from "@/lib/protocol/sensors";
import type { NodeRegistry, RegisteredNode } from "./node-registry";
import type { LiveCache } from "./live-cache";
import type { PersistenceWorker } from "./persistence";
import type { SubscriptionHub } from "./subscriptions";

export type IngestResult =
  | { status: "accepted"; nodeId: number; values: Record<string, number>; alarm: number | null; control: string[] }
  | { status: "malformed"; code: string }
  | { status: "unknown-node"; nodeId: number }
  | { status: "lookup-failed"; nodeId: number };

export interface IngestDeps {
  registry: NodeRegistry;
  cache: LiveCache;
  hub: Pick<SubscriptionHub, "publish">;
  worker: Pick<PersistenceWorker, "enqueue">;
  encoding: PayloadEncoding;
  onDiscovered?: (node: RegisteredNode, sensorId: string, at: Date) => void;
  onActivity?: (node: RegisteredNode, at: Date) => void;
  log?: { warn: (m: string, meta?: Record<string, unknown>) => void; debug?: (m: string, meta?: Record<string, unknown>) => void };
  now?: () => number;
}

export interface IngestStats {
  received: number;
  accepted: number;
  malformed: number;
  unknownNode: number;
  lookupFailed: number;
}

/**
 * MQTT ingestion pipeline:
 *   validate envelope → decode payload → verify registered Node (DB, cached)
 *   → extract sensor values (control/alarm separated) → update latest-value cache
 *   → publish to authorized WebSocket subscribers → queue for persistence.
 * Unknown Node IDs are rejected (never auto-created). Site ownership comes only
 * from Node.siteId in MongoDB, never from the device payload.
 */
export class Ingestor {
  stats: IngestStats = { received: 0, accepted: 0, malformed: 0, unknownNode: 0, lookupFailed: 0 };
  private warnedUnknown = new Map<number, number>();

  constructor(private deps: IngestDeps) {}

  private throttledWarn(key: number, msg: string, meta: Record<string, unknown>) {
    const now = (this.deps.now ?? Date.now)();
    const last = this.warnedUnknown.get(key) ?? 0;
    if (now - last > 60_000) {
      this.warnedUnknown.set(key, now);
      this.deps.log?.warn(msg, meta);
    }
  }

  async handle(payload: Buffer | string): Promise<IngestResult> {
    this.stats.received++;
    let decoded;
    try {
      decoded = decodeEnvelope(payload, this.deps.encoding);
    } catch (e) {
      this.stats.malformed++;
      const code = e instanceof DecodeError ? e.code : "UNKNOWN";
      this.throttledWarn(-1, "Rejected malformed MQTT message", { code });
      return { status: "malformed", code };
    }

    let node: RegisteredNode | null;
    try {
      node = await this.deps.registry.get(decoded.nodeId);
    } catch {
      this.stats.lookupFailed++;
      this.throttledWarn(-2, "Node lookup failed (database unavailable); message dropped", { nodeId: decoded.nodeId });
      return { status: "lookup-failed", nodeId: decoded.nodeId };
    }
    if (!node) {
      this.stats.unknownNode++;
      this.throttledWarn(decoded.nodeId, "Rejected message from unregistered Node", { nodeId: decoded.nodeId });
      return { status: "unknown-node", nodeId: decoded.nodeId };
    }

    const parsed = parsePayload(decoded.data);
    const receivedAt = new Date((this.deps.now ?? Date.now)());
    const timestamp = receivedAt.toISOString();
    this.deps.onActivity?.(node, receivedAt);
    if (parsed.rejected.length) this.deps.log?.debug?.("Ignored non-sensor keys", { nodeId: node.nodeId, keys: parsed.rejected });

    const sensorIds = Object.keys(parsed.values);
    for (const id of sensorIds) {
      if (!node.discovered.has(id) && sensorTypeOf(id)) {
        node.discovered.add(id);
        this.deps.onDiscovered?.(node, id, receivedAt);
      }
    }
    if (sensorIds.length) {
      this.deps.cache.update(node.nodeId, parsed.values, timestamp, parsed.alarm);
      this.deps.hub.publish(node.nodeId, { timestamp, values: parsed.values, alarm: parsed.alarm });
    }
    this.deps.worker.enqueue({
      nodeId: node.nodeId,
      nodeRef: node._id,
      data: decoded.data, // original decoded payload, unmodified
      receivedAt,
      values: parsed.values,
      alarm: parsed.alarm,
    });
    this.stats.accepted++;
    const control = Object.entries(parsed.control).filter(([, v]) => v).map(([k]) => k);
    return { status: "accepted", nodeId: node.nodeId, values: parsed.values, alarm: parsed.alarm, control };
  }
}
