import { describe, it, expect, vi, afterEach } from "vitest";
import { Types } from "mongoose";
import { PersistenceWorker, isOnlyDuplicateKeyError, type ReadingDoc } from "@/realtime/persistence";

const nodeRef = new Types.ObjectId().toString();
const msg = (values: Record<string, number>, t = 0, extra: Record<string, unknown> = {}) => ({
  nodeId: 1001,
  nodeRef,
  data: { ...values, ...extra, start: 1 },
  receivedAt: new Date(t),
  values,
  alarm: (extra.alarm as number) ?? null,
});

afterEach(() => vi.useRealTimers());

describe("PersistenceWorker (snapshot mode)", () => {
  it("writes the latest original message per shape, batched", async () => {
    const writes: ReadingDoc[][] = [];
    const w = new PersistenceWorker(async (d) => void writes.push(d), { intervalSeconds: 5 });
    w.enqueue(msg({ RES_0: 1 }, 1, { alarm: 0 }));
    w.enqueue(msg({ RES_0: 4 }, 2, { alarm: 0 }));
    w.enqueue(msg({ VMR_R: 224, VMR_Y: 212, VMR_B: 210 }, 3));
    const r = await w.flush();
    expect(r).toEqual({ written: 2, skipped: 0, failed: 0 });
    expect(writes).toHaveLength(1);
    const data = writes[0].map((d) => d.data);
    expect(data).toContainEqual({ RES_0: 4, alarm: 0, start: 1 }); // original payload preserved
    expect(data).toContainEqual({ VMR_R: 224, VMR_Y: 212, VMR_B: 210, start: 1 });
    expect(writes[0][0].nodeRef.toString()).toBe(nodeRef);
  });

  it("does not store control-only messages", async () => {
    const write = vi.fn(async () => {});
    const w = new PersistenceWorker(write, { intervalSeconds: 5 });
    w.enqueue({ ...msg({}), data: { initialStart: 1 } });
    w.enqueue({ ...msg({}), data: { end: 1 } });
    expect(await w.flush()).toEqual({ written: 0, skipped: 0, failed: 0 });
    expect(write).not.toHaveBeenCalled();
  });

  it("skips unchanged snapshots until the keepalive elapses", async () => {
    let now = 0;
    const write = vi.fn(async () => {});
    const w = new PersistenceWorker(write, { intervalSeconds: 5, keepaliveMs: 60_000, now: () => now });
    w.enqueue(msg({ RES_0: 4 }));
    await w.flush();
    now = 5_000;
    w.enqueue(msg({ RES_0: 4 }));
    expect((await w.flush()).skipped).toBe(1);
    now = 10_000;
    w.enqueue(msg({ RES_0: 5 }));
    expect((await w.flush()).written).toBe(1);
    now = 80_000;
    w.enqueue(msg({ RES_0: 5 }));
    expect((await w.flush()).written).toBe(1);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("retains pending data on DB failure and retries with the same _id (idempotent)", async () => {
    const ids: string[][] = [];
    let fail = true;
    const errors: unknown[] = [];
    const w = new PersistenceWorker(
      async (d) => {
        ids.push(d.map((x) => x._id.toString()));
        if (fail) throw new Error("db down");
      },
      { intervalSeconds: 5, onError: (e) => errors.push(e) },
    );
    w.enqueue(msg({ RES_0: 4 }));
    expect((await w.flush()).failed).toBe(1);
    expect(w.pendingCount()).toBe(1);
    expect(errors).toHaveLength(1);
    fail = false;
    expect((await w.flush()).written).toBe(1);
    expect(ids[0]).toEqual(ids[1]);
    expect(w.pendingCount()).toBe(0);
  });

  it("a newer message received during a failed write takes precedence on retry", async () => {
    let fail = true;
    const written: ReadingDoc[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = new PersistenceWorker(
      async (d) => {
        await gate;
        if (fail) throw new Error("x");
        written.push(...d);
      },
      { intervalSeconds: 5 },
    );
    w.enqueue(msg({ RES_0: 1 }));
    const p = w.flush();
    w.enqueue(msg({ RES_0: 2 }));
    release();
    await p;
    fail = false;
    await w.flush();
    expect(written.map((d) => d.data.RES_0)).toEqual([2]);
  });

  it("runs a single timer on the configured interval and applies interval changes", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    const w = new PersistenceWorker(write, { intervalSeconds: 5 });
    w.start();
    w.start(); // second start is a no-op (no duplicate timers)
    w.enqueue(msg({ RES_0: 1 }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    w.setIntervalSeconds(2);
    expect(w.getIntervalSeconds()).toBe(2);
    w.enqueue(msg({ RES_0: 2 }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(write).toHaveBeenCalledTimes(2);
    w.stop();
    expect(w.isRunning()).toBe(false);
  });

  it("never overlaps flushes", async () => {
    let concurrent = 0;
    let max = 0;
    const w = new PersistenceWorker(
      async () => {
        concurrent++;
        max = Math.max(max, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      },
      { intervalSeconds: 5 },
    );
    w.enqueue(msg({ RES_0: 1 }));
    await Promise.all([w.flush(), w.flush(), w.flush()]);
    expect(max).toBe(1);
  });
});

describe("PersistenceWorker (raw mode)", () => {
  it("stores every message including control messages, in order", async () => {
    const written: ReadingDoc[] = [];
    const w = new PersistenceWorker(async (d) => void written.push(...d), { intervalSeconds: 5, mode: "raw" });
    w.enqueue({ ...msg({}), data: { initialStart: 1 } });
    w.enqueue(msg({ RES_0: 1 }));
    w.enqueue(msg({ RES_0: 1 }));
    w.enqueue({ ...msg({}), data: { end: 1 } });
    await w.flush();
    expect(written.map((d) => d.data)).toEqual([{ initialStart: 1 }, { RES_0: 1, start: 1 }, { RES_0: 1, start: 1 }, { end: 1 }]);
  });
});

describe("isOnlyDuplicateKeyError", () => {
  it("detects duplicate-only bulk errors", () => {
    expect(isOnlyDuplicateKeyError({ writeErrors: [{ code: 11000 }, { err: { code: 11000 } }] })).toBe(true);
    expect(isOnlyDuplicateKeyError({ writeErrors: [{ code: 11000 }, { code: 121 }] })).toBe(false);
    expect(isOnlyDuplicateKeyError(new Error("network"))).toBe(false);
  });
});
