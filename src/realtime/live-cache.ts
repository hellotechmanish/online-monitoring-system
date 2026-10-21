/**
 * In-memory latest-value cache keyed by Node ID and sensor ID.
 * It is per-process: it starts empty after a restart (initial chart history is
 * restored from MongoDB instead) and is NOT shared between instances. For a
 * multi-instance deployment, publish ingested events through a shared broker
 * (e.g. Redis pub/sub) or run exactly one realtime instance.
 */
export interface CachedValue {
  value: number;
  timestamp: string;
  alarm: number | null;
}

export class LiveCache {
  private nodes = new Map<number, Map<string, CachedValue>>();

  update(nodeId: number, values: Record<string, number>, timestamp: string, alarm: number | null) {
    let m = this.nodes.get(nodeId);
    if (!m) {
      m = new Map();
      this.nodes.set(nodeId, m);
    }
    for (const [k, v] of Object.entries(values)) m.set(k, { value: v, timestamp, alarm });
  }

  get(nodeId: number, sensors?: string[]): Record<string, CachedValue> {
    const m = this.nodes.get(nodeId);
    const out: Record<string, CachedValue> = {};
    if (!m) return out;
    for (const [k, v] of m) if (!sensors || sensors.includes(k)) out[k] = v;
    return out;
  }

  clear(nodeId?: number) {
    if (nodeId === undefined) this.nodes.clear();
    else this.nodes.delete(nodeId);
  }
}
