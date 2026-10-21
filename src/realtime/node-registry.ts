import type { SensorConfigLike, SensorType } from "@/lib/protocol/sensors";

/** Registered Node as seen by the realtime service. Site ownership always comes from the DB. */
export interface RegisteredNode {
  _id: string;
  nodeId: number;
  siteId: string;
  sensors: SensorConfigLike[];
  sensorTypes: Set<SensorType>;
  discovered: Set<string>;
}

export type NodeLoader = (nodeId: number) => Promise<RegisteredNode | null>;

interface Entry {
  node: RegisteredNode | null;
  expires: number;
}

/**
 * Caches Node lookups for MQTT ingestion (positive and negative), so a busy
 * device does not trigger one DB query per message. Config edits made in the
 * CRM are picked up when the entry expires (default 30 s).
 * On a DB error, a stale entry is used if available; otherwise the message is rejected.
 */
export class NodeRegistry {
  private cache = new Map<number, Entry>();
  private inflight = new Map<number, Promise<RegisteredNode | null>>();

  constructor(
    private loader: NodeLoader,
    private ttlMs = 30_000,
    private now: () => number = Date.now,
  ) {}

  async get(nodeId: number): Promise<RegisteredNode | null> {
    const hit = this.cache.get(nodeId);
    if (hit && hit.expires > this.now()) return hit.node;
    let p = this.inflight.get(nodeId);
    if (!p) {
      p = this.loader(nodeId)
        .then((node) => {
          // Keep discovered IDs learned in-memory if the DB copy lags behind.
          if (node && hit?.node) for (const s of hit.node.discovered) node.discovered.add(s);
          this.cache.set(nodeId, { node, expires: this.now() + this.ttlMs });
          return node;
        })
        .catch((e) => {
          if (hit) {
            this.cache.set(nodeId, { node: hit.node, expires: this.now() + 5_000 });
            return hit.node;
          }
          throw e;
        })
        .finally(() => this.inflight.delete(nodeId));
      this.inflight.set(nodeId, p);
    }
    return p;
  }

  invalidate(nodeId?: number) {
    if (nodeId === undefined) this.cache.clear();
    else this.cache.delete(nodeId);
  }

  size() {
    return this.cache.size;
  }
}
