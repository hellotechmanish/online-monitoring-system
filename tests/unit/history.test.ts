import { describe, it, expect } from "vitest";
import { buildHistory, type StoredReadingLike } from "@/lib/history";

const at = (s: number) => new Date(Date.UTC(2026, 9, 18, 5, 29, s));

describe("buildHistory", () => {
  const docs: StoredReadingLike[] = [];
  for (let i = 0; i < 30; i++) docs.push({ receivedAt: at(i), data: { RES_0: i, alarm: 0, start: 1 } });
  for (let i = 0; i < 5; i++) docs.push({ receivedAt: at(i * 2 + 0.5), data: { RES_1: 100 + i, alarm: 1, start: 1 } });
  docs.push({ receivedAt: at(40), data: { VMR_R: 224, VMR_Y: 212, VMR_B: 210, start: 1 } });

  // Simulates: find({nodeId, ["data."+s]: {$exists:true}}).sort({receivedAt:-1}).limit(n)
  const fetcher = async (s: string, n: number) =>
    docs
      .filter((d) => s in d.data)
      .sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt))
      .slice(0, n);

  it("returns the latest N points per sensor, oldest → newest", async () => {
    const pts = await buildHistory(["RES_0", "RES_1"], 20, fetcher);
    const res0 = pts.filter((p) => "RES_0" in p.values).map((p) => p.values.RES_0);
    const res1 = pts.filter((p) => "RES_1" in p.values).map((p) => p.values.RES_1);
    expect(res0).toEqual(Array.from({ length: 20 }, (_, i) => i + 10));
    // RES_1 is sparse and older than most RES_0 points, yet still gets its history.
    expect(res1).toEqual([100, 101, 102, 103, 104]);
    const times = pts.map((p) => Date.parse(p.timestamp));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("extracts requested keys from multi-key documents without other keys", async () => {
    const pts = await buildHistory(["VMR_R", "VMR_B"], 20, fetcher);
    expect(pts).toEqual([{ timestamp: at(40).toISOString(), values: { VMR_R: 224, VMR_B: 210 } }]);
    expect(docs.at(-1)!.data).toEqual({ VMR_R: 224, VMR_Y: 212, VMR_B: 210, start: 1 });
  });

  it("handles empty history", async () => {
    expect(await buildHistory(["NER_0"], 20, fetcher)).toEqual([]);
  });
});
