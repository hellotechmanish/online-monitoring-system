import { describe, it, expect } from "vitest";
import { ActivityTracker, type ActivityStore } from "@/realtime/activity";

function store() {
  const log: string[] = [];
  let active = 0;
  let maxActive = 0;
  const s: ActivityStore & { log: string[]; maxActive: () => number; online: string[][]; offline: string[][] } = {
    log,
    online: [],
    offline: [],
    maxActive: () => maxActive,
    markOnline: async (u) => void s.online.push(u.map((x) => x.nodeRef)),
    markOffline: async (r) => void s.offline.push(r),
    addDiscovered: async (ref, id) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      log.push(`${ref}:${id}`);
      active--;
    },
  };
  return s;
}

describe("ActivityTracker", () => {
  it("serializes discovery writes per Node (no lost updates)", async () => {
    const st = store();
    const t = new ActivityTracker(st, 60_000);
    const at = new Date();
    t.discovered("n1", "VMR_R", "VMR", at);
    t.discovered("n1", "VMR_Y", "VMR", at);
    t.discovered("n1", "VMR_B", "VMR", at);
    await t.drain();
    expect(st.log).toEqual(["n1:VMR_R", "n1:VMR_Y", "n1:VMR_B"]);
    expect(st.maxActive()).toBe(1);
  });

  it("batches online updates per tick and marks silent Nodes offline", async () => {
    let now = 0;
    const st = store();
    const t = new ActivityTracker(st, 10_000, () => now);
    t.touch("n1", new Date(0));
    t.touch("n1", new Date(1));
    t.touch("n2", new Date(1));
    await t.tick();
    expect(st.online).toEqual([["n1", "n2"]]);
    now = 5_000;
    t.touch("n2", new Date(5_000));
    await t.tick();
    expect(st.offline).toEqual([]);
    now = 12_000;
    await t.tick();
    expect(st.offline).toEqual([["n1"]]);
  });
});
