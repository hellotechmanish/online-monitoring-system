import { Types } from "mongoose";

/**
 * History policies
 * ----------------
 * "snapshot" (default): every `databaseSaveIntervalSeconds`, for each Node and
 *   each message shape (the set of sensor keys in a message, e.g. {RES_0} or
 *   {VMR_R,VMR_Y,VMR_B}), the LATEST original message received in the interval
 *   is written unchanged. Messages superseded within the same interval are NOT
 *   stored, and a message whose values equal the last stored ones is skipped
 *   unless `keepaliveMs` has elapsed (one periodic sample per minute by default).
 *   => The database does not contain every MQTT update.
 * "raw": every received message (including control messages such as
 *   initialStart/end) is stored, batched at the same interval. Complete
 *   message-by-message history, at the cost of storage.
 *
 * Writes are idempotent: each pending document gets its _id before the first
 * attempt, so a retried batch that partially succeeded does not duplicate rows.
 */
export type HistoryMode = "snapshot" | "raw";

export interface PendingReading {
  _id?: Types.ObjectId;
  nodeId: number;
  nodeRef: string;
  data: Record<string, unknown>;
  receivedAt: Date;
  values: Record<string, number>;
  alarm: number | null;
}

export interface ReadingDoc {
  _id: Types.ObjectId;
  nodeId: number;
  nodeRef: Types.ObjectId;
  data: Record<string, unknown>;
  receivedAt: Date;
}

export type ReadingWriter = (docs: ReadingDoc[]) => Promise<void>;

export interface FlushResult {
  written: number;
  skipped: number;
  failed: number;
}

export interface WorkerOptions {
  intervalSeconds: number;
  mode?: HistoryMode;
  keepaliveMs?: number;
  maxPending?: number;
  now?: () => number;
  onError?: (e: unknown, pending: number) => void;
  onFlush?: (r: FlushResult) => void;
}

export class PersistenceWorker {
  private snapshotPending = new Map<string, PendingReading>();
  private rawPending: PendingReading[] = [];
  private lastStored = new Map<string, { sig: string; at: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<FlushResult> | null = null;
  private intervalSeconds: number;
  readonly mode: HistoryMode;
  private keepaliveMs: number;
  private maxPending: number;
  private now: () => number;
  dropped = 0;

  constructor(private writer: ReadingWriter, private opts: WorkerOptions) {
    this.intervalSeconds = Math.max(1, Math.floor(opts.intervalSeconds || 5));
    this.mode = opts.mode ?? "snapshot";
    this.keepaliveMs = opts.keepaliveMs ?? 60_000;
    this.maxPending = opts.maxPending ?? 50_000;
    this.now = opts.now ?? Date.now;
  }

  static shapeKey(r: Pick<PendingReading, "nodeId" | "values">): string {
    return `${r.nodeId}|${Object.keys(r.values).sort().join(",")}`;
  }

  enqueue(r: PendingReading) {
    if (this.mode === "raw") {
      if (this.rawPending.length >= this.maxPending) {
        this.rawPending.shift();
        this.dropped++;
      }
      this.rawPending.push(r);
      return;
    }
    if (Object.keys(r.values).length === 0) return; // control-only messages are not snapshots
    const key = PersistenceWorker.shapeKey(r);
    if (!this.snapshotPending.has(key) && this.snapshotPending.size >= this.maxPending) {
      this.dropped++;
      return;
    }
    this.snapshotPending.set(key, r); // latest message for this shape wins
  }

  pendingCount(): number {
    return this.mode === "raw" ? this.rawPending.length : this.snapshotPending.size;
  }

  getIntervalSeconds() {
    return this.intervalSeconds;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRunning() {
    return this.timer !== null;
  }

  /** Applies a new interval (from GlobalSetting) by restarting the single timer. */
  setIntervalSeconds(seconds: number) {
    const s = Math.max(1, Math.floor(seconds));
    if (!Number.isFinite(s) || s === this.intervalSeconds) return;
    this.intervalSeconds = s;
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  async flush(): Promise<FlushResult> {
    if (this.flushing) return this.flushing; // never overlap flushes
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private sig(r: PendingReading) {
    return JSON.stringify([r.values, r.alarm]);
  }

  private async doFlush(): Promise<FlushResult> {
    const now = this.now();
    let batch: Array<{ key: string; r: PendingReading }> = [];
    let skipped = 0;
    if (this.mode === "raw") {
      batch = this.rawPending.map((r) => ({ key: "", r }));
      this.rawPending = [];
    } else {
      for (const [key, r] of this.snapshotPending) {
        const last = this.lastStored.get(key);
        if (last && last.sig === this.sig(r) && now - last.at < this.keepaliveMs) {
          skipped++;
          continue;
        }
        batch.push({ key, r });
      }
      this.snapshotPending.clear();
    }
    if (batch.length === 0) {
      const res = { written: 0, skipped, failed: 0 };
      this.opts.onFlush?.(res);
      return res;
    }
    for (const b of batch) b.r._id ??= new Types.ObjectId();
    const docs: ReadingDoc[] = batch.map(({ r }) => ({
      _id: r._id!,
      nodeId: r.nodeId,
      nodeRef: new Types.ObjectId(r.nodeRef),
      data: r.data,
      receivedAt: r.receivedAt,
    }));
    try {
      await this.writer(docs);
      if (this.mode === "snapshot") {
        for (const { key, r } of batch) this.lastStored.set(key, { sig: this.sig(r), at: now });
      }
      const res = { written: docs.length, skipped, failed: 0 };
      this.opts.onFlush?.(res);
      return res;
    } catch (e) {
      // Retain pending data for the next attempt; newer messages for the same shape take precedence.
      if (this.mode === "raw") {
        this.rawPending = [...batch.map((b) => b.r), ...this.rawPending];
        if (this.rawPending.length > this.maxPending) {
          const extra = this.rawPending.length - this.maxPending;
          this.rawPending.splice(0, extra);
          this.dropped += extra;
        }
      } else {
        for (const { key, r } of batch) if (!this.snapshotPending.has(key)) this.snapshotPending.set(key, r);
      }
      this.opts.onError?.(e, this.pendingCount());
      return { written: 0, skipped, failed: docs.length };
    }
  }
}

/** True when a bulk insert error only consists of duplicate-_id errors (i.e. already stored). */
export function isOnlyDuplicateKeyError(e: unknown): boolean {
  const err = e as { code?: number; writeErrors?: Array<{ code?: number; err?: { code?: number } }> };
  if (err?.code === 11000 && !err.writeErrors) return true;
  const list = err?.writeErrors;
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.every((w) => (w.code ?? w.err?.code) === 11000);
}
