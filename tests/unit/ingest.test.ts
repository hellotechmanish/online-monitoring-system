import { describe, it, expect, vi } from "vitest";
import { Ingestor } from "@/realtime/ingest";
import { NodeRegistry, type RegisteredNode } from "@/realtime/node-registry";
import { LiveCache } from "@/realtime/live-cache";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const envelope = (nodeId: number, data: unknown) => Buffer.from(JSON.stringify({ Node_Id: nodeId, data: b64(data) }));

function setup(loader?: (id: number) => Promise<RegisteredNode | null>) {
  const node: RegisteredNode = {
    _id: "6650f0f0f0f0f0f0f0f0f0f0",
    nodeId: 1001,
    siteId: "a".repeat(24),
    sensors: [{ sensorType: "RES", quantity: 2 }],
    sensorTypes: new Set(["RES"]),
    discovered: new Set(),
  };
  const load = vi.fn(loader ?? (async (id: number) => (id === 1001 ? { ...node, discovered: new Set<string>() } : null)));
  const registry = new NodeRegistry(load, 30_000);
  const cache = new LiveCache();
  const hub = { publish: vi.fn(() => 1) };
  const worker = { enqueue: vi.fn() };
  const discovered: string[] = [];
  const ing = new Ingestor({
    registry,
    cache,
    hub,
    worker,
    encoding: "auto",
    onDiscovered: (_n, id) => discovered.push(id),
    now: () => Date.UTC(2026, 9, 18, 5, 30, 0),
  });
  return { ing, load, cache, hub, worker, discovered };
}

describe("Ingestor", () => {
  it("accepts a registered Node: cache, publish, persistence queue, original payload", async () => {
    const { ing, cache, hub, worker } = setup();
    const r = await ing.handle(envelope(1001, { RES_0: 4, alarm: 0, start: 1 }));
    expect(r).toMatchObject({ status: "accepted", values: { RES_0: 4 }, alarm: 0, control: ["start"] });
    expect(cache.get(1001).RES_0).toEqual({ value: 4, timestamp: "2026-10-18T05:30:00.000Z", alarm: 0 });
    expect(hub.publish).toHaveBeenCalledWith(1001, { timestamp: "2026-10-18T05:30:00.000Z", values: { RES_0: 4 }, alarm: 0 });
    expect(worker.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 1001, nodeRef: "6650f0f0f0f0f0f0f0f0f0f0", data: { RES_0: 4, alarm: 0, start: 1 } }),
    );
  });

  it("rejects unknown Node IDs without caching, publishing or persisting", async () => {
    const { ing, hub, worker } = setup();
    const r = await ing.handle(envelope(4242, { RES_0: 1 }));
    expect(r).toEqual({ status: "unknown-node", nodeId: 4242 });
    expect(hub.publish).not.toHaveBeenCalled();
    expect(worker.enqueue).not.toHaveBeenCalled();
    expect(ing.stats.unknownNode).toBe(1);
  });

  it("ignores a siteId supplied in the device payload", async () => {
    const { ing, worker } = setup();
    await ing.handle(envelope(1001, { RES_0: 4, siteId: "b".repeat(24), start: 1 }));
    // Stored as received (original payload), but Site membership is never taken from it.
    expect(worker.enqueue.mock.calls[0][0].nodeRef).toBe("6650f0f0f0f0f0f0f0f0f0f0");
  });

  it("handles control messages: queued (raw mode may store them) but not published", async () => {
    const { ing, hub } = setup();
    expect(await ing.handle(envelope(1001, { initialStart: 1 }))).toMatchObject({ status: "accepted", values: {}, control: ["initialStart"] });
    expect(await ing.handle(envelope(1001, { end: 1 }))).toMatchObject({ control: ["end"] });
    expect(hub.publish).not.toHaveBeenCalled();
  });

  it("reports malformed payloads safely", async () => {
    const { ing } = setup();
    expect(await ing.handle(Buffer.from("garbage"))).toEqual({ status: "malformed", code: "INVALID_JSON" });
    expect(await ing.handle(Buffer.from(JSON.stringify({ Node_Id: 1001, data: "!!!" })))).toMatchObject({ status: "malformed" });
    expect(ing.stats.malformed).toBe(2);
  });

  it("caches Node lookups and records newly discovered channels once", async () => {
    const { ing, load, discovered } = setup();
    await ing.handle(envelope(1001, { RES_0: 1, start: 1 }));
    await ing.handle(envelope(1001, { RES_0: 2, start: 1 }));
    await ing.handle(envelope(1001, { RES_1: 0, start: 1 }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(discovered).toEqual(["RES_0", "RES_1"]);
  });

  it("drops messages when the Node cannot be verified (DB down, nothing cached)", async () => {
    const { ing, worker } = setup(async () => {
      throw new Error("db down");
    });
    expect(await ing.handle(envelope(1001, { RES_0: 1 }))).toEqual({ status: "lookup-failed", nodeId: 1001 });
    expect(worker.enqueue).not.toHaveBeenCalled();
  });
});
