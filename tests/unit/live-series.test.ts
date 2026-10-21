import { describe, it, expect } from "vitest";
import { applyEvent, applyHistory, applyLatestSnapshot, createSeriesState, toChartRows, pointCount } from "@/lib/live-series";

const ts = (s: number) => new Date(Date.UTC(2026, 9, 18, 5, 30, s)).toISOString();

describe("live chart series", () => {
  it("keeps one independent bounded series per selected sensor", () => {
    let st = applyHistory(createSeriesState(1001, ["RES_0", "RES_1"], 3), []);
    for (let i = 0; i < 5; i++) st = applyEvent(st, { nodeId: 1001, timestamp: ts(i), values: { RES_0: i, RES_1: i * 10 } });
    expect(st.series.RES_0.map((p) => p.v)).toEqual([2, 3, 4]);
    expect(st.series.RES_1.map((p) => p.v)).toEqual([20, 30, 40]);
  });

  it("ignores other Nodes and unselected sensors", () => {
    let st = applyHistory(createSeriesState(1001, ["RES_0"], 20), []);
    st = applyEvent(st, { nodeId: 1002, timestamp: ts(1), values: { RES_0: 9 } });
    st = applyEvent(st, { nodeId: 1001, timestamp: ts(2), values: { NER_0: 0.5 } });
    expect(pointCount(st)).toBe(0);
  });

  it("does not fabricate values for sensors missing from a message", () => {
    let st = applyHistory(createSeriesState(1001, ["RES_0", "RES_1"], 20), []);
    st = applyEvent(st, { nodeId: 1001, timestamp: ts(1), values: { RES_0: 4 } });
    st = applyEvent(st, { nodeId: 1001, timestamp: ts(2), values: { RES_1: 0 } });
    const rows = toChartRows(st);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ RES_0: 4, RES_1: null });
    expect(rows[1]).toMatchObject({ RES_0: null, RES_1: 0 });
  });

  it("processes multiple sensors from one message at the same timestamp", () => {
    let st = applyHistory(createSeriesState(1001, ["VMR_R", "VMR_Y", "VMR_B"], 20), []);
    st = applyEvent(st, { nodeId: 1001, timestamp: ts(1), values: { VMR_R: 224, VMR_Y: 212, VMR_B: 210 } });
    expect(toChartRows(st)).toEqual([{ t: Date.parse(ts(1)), VMR_R: 224, VMR_Y: 212, VMR_B: 210 }]);
  });

  it("buffers live events during history load and replays them after (no overwrite race)", () => {
    let st = createSeriesState(1001, ["RES_0"], 20);
    st = applyEvent(st, { nodeId: 1001, timestamp: ts(30), values: { RES_0: 99 } });
    expect(pointCount(st)).toBe(0);
    st = applyHistory(st, [
      { timestamp: ts(10), values: { RES_0: 1 } },
      { timestamp: ts(20), values: { RES_0: 2 } },
    ]);
    expect(st.series.RES_0.map((p) => p.v)).toEqual([1, 2, 99]);
    expect(st.latest.RES_0.value).toBe(99);
  });

  it("restores history oldest→newest, bounded per sensor, then appends live data", () => {
    const history = Array.from({ length: 25 }, (_, i) => ({ timestamp: ts(i), values: { RES_0: i } })).reverse();
    let st = applyHistory(createSeriesState(1001, ["RES_0"], 20), history);
    expect(st.series.RES_0).toHaveLength(20);
    expect(st.series.RES_0[0].v).toBe(5);
    st = applyEvent(st, { nodeId: 1001, timestamp: ts(40), values: { RES_0: 100 } });
    expect(st.series.RES_0).toHaveLength(20);
    expect(st.series.RES_0.at(-1)!.v).toBe(100);
  });

  it("deduplicates an event whose timestamp equals a history point", () => {
    let st = createSeriesState(1001, ["RES_0"], 20);
    st = applyEvent(st, { nodeId: 1001, timestamp: ts(20), values: { RES_0: 2 } });
    st = applyHistory(st, [{ timestamp: ts(20), values: { RES_0: 2 } }]);
    expect(st.series.RES_0).toHaveLength(1);
  });

  it("latest snapshot updates latest values but adds no chart points", () => {
    let st = applyHistory(createSeriesState(1001, ["RES_0"], 20), []);
    st = applyLatestSnapshot(st, { RES_0: { value: 3, timestamp: ts(5), alarm: 0 }, NER_0: { value: 1, timestamp: ts(5), alarm: 0 } });
    expect(st.latest.RES_0.value).toBe(3);
    expect(st.latest.NER_0).toBeUndefined();
    expect(pointCount(st)).toBe(0);
  });

  it("a fresh state for a new Node starts empty (no stale data after switching)", () => {
    let a = applyHistory(createSeriesState(1001, ["RES_0"], 20), [{ timestamp: ts(1), values: { RES_0: 1 } }]);
    a = applyEvent(a, { nodeId: 1001, timestamp: ts(2), values: { RES_0: 2 } });
    let b = createSeriesState(1002, ["RES_0"], 20);
    b = applyEvent(b, { nodeId: 1001, timestamp: ts(3), values: { RES_0: 3 } }); // late event from old Node
    b = applyHistory(b, []);
    expect(pointCount(b)).toBe(0);
  });
});
