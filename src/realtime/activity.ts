/**
 * Tracks Node activity and writes status changes in batches (not per message):
 *  - lastReadingAt / status "online" for Nodes that sent messages since the last tick
 *  - status "offline" for Nodes silent for longer than `offlineAfterMs`
 *  - newly discovered sensor channel IDs (written immediately, guarded against duplicates)
 */
export interface ActivityStore {
  markOnline(updates: Array<{ nodeRef: string; lastReadingAt: Date }>): Promise<void>;
  markOffline(nodeRefs: string[]): Promise<void>;
  addDiscovered(nodeRef: string, sensorId: string, sensorType: string, at: Date): Promise<void>;
}

export class ActivityTracker {
  private lastSeen = new Map<string, number>();
  private dirty = new Map<string, Date>();
  private online = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Per-Node write chains: discovery writes for one Node never run concurrently. */
  private chains = new Map<string, Promise<void>>();

  constructor(
    private store: ActivityStore,
    private offlineAfterMs: number,
    private now: () => number = Date.now,
    private onError: (e: unknown) => void = () => {},
  ) {}

  touch(nodeRef: string, at: Date) {
    this.lastSeen.set(nodeRef, at.getTime());
    this.dirty.set(nodeRef, at);
  }

  discovered(nodeRef: string, sensorId: string, sensorType: string, at: Date): Promise<void> {
    const prev = this.chains.get(nodeRef) ?? Promise.resolve();
    const next = prev
      .then(() => this.store.addDiscovered(nodeRef, sensorId, sensorType, at))
      .catch(this.onError)
      .finally(() => {
        if (this.chains.get(nodeRef) === next) this.chains.delete(nodeRef);
      });
    this.chains.set(nodeRef, next);
    return next;
  }

  /** Waits for queued discovery writes (used on shutdown). */
  async drain() {
    await Promise.all(Array.from(this.chains.values()));
  }

  async tick() {
    const updates = Array.from(this.dirty.entries()).map(([nodeRef, lastReadingAt]) => ({ nodeRef, lastReadingAt }));
    this.dirty.clear();
    const now = this.now();
    const offline: string[] = [];
    for (const [ref, t] of this.lastSeen) {
      if (now - t > this.offlineAfterMs && this.online.has(ref)) offline.push(ref);
    }
    try {
      if (updates.length) {
        await this.store.markOnline(updates);
        for (const u of updates) this.online.add(u.nodeRef);
      }
      if (offline.length) {
        await this.store.markOffline(offline);
        for (const r of offline) this.online.delete(r);
      }
    } catch (e) {
      for (const u of updates) if (!this.dirty.has(u.nodeRef)) this.dirty.set(u.nodeRef, u.lastReadingAt);
      this.onError(e);
    }
  }

  start(intervalMs = 15_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
