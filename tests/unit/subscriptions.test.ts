import { describe, it, expect, beforeEach } from "vitest";
import { SubscriptionHub, type HubClient, type HubNode } from "@/realtime/subscriptions";
import type { SessionUser } from "@/lib/auth/rbac";

const SITE_A = "a".repeat(24);
const SITE_B = "b".repeat(24);
const nodes: Record<number, HubNode> = {
  1001: { nodeId: 1001, siteId: SITE_A, sensors: [{ sensorType: "RES", quantity: 2 }, { sensorType: "VMR", quantity: 3 }] },
  1004: { nodeId: 1004, siteId: SITE_B, sensors: [{ sensorType: "RES", quantity: 2 }] },
};
const users: Record<string, SessionUser & { active: boolean }> = {
  admin: { id: "admin", name: "A", username: "admin", role: "admin", assignedSites: [], active: true },
  tech: { id: "tech", name: "T", username: "tech", role: "technician", assignedSites: [], active: true },
  userA: { id: "userA", name: "U", username: "usera", role: "user", assignedSites: [SITE_A], active: true },
};

function mkClient(userId: string, id = userId) {
  const msgs: Record<string, unknown>[] = [];
  let closed: number | null = null;
  const c: HubClient = { id, userId, user: users[userId], send: (m) => msgs.push(m), close: (code) => (closed = code ?? 1000) };
  return { c, msgs, closed: () => closed, last: () => msgs[msgs.length - 1] };
}

let hub: SubscriptionHub;
beforeEach(() => {
  hub = new SubscriptionHub({
    loadUser: async (id) => (users[id]?.active ? users[id] : null),
    findNode: async (n) => nodes[n] ?? null,
    latest: () => ({}),
  });
});

const sub = (requestId: string, siteId: string, nodeId: number, sensors: string[]) =>
  JSON.stringify({ action: "subscribe", requestId, siteId, nodeId, sensors });

describe("SubscriptionHub", () => {
  it("sends hello with status on connect", () => {
    const a = mkClient("admin");
    hub.addClient(a.c);
    expect(a.msgs[0]).toMatchObject({ type: "hello", status: { mqtt: "disabled", liveEnabled: true } });
  });

  it("authorizes Site access: user may subscribe to assigned Site only", async () => {
    const u = mkClient("userA");
    hub.addClient(u.c);
    await hub.handleMessage("userA", sub("r1", SITE_A, 1001, ["RES_0"]));
    expect(u.last()).toMatchObject({ type: "subscribed", requestId: "r1", nodeId: 1001, sensors: ["RES_0"] });
    await hub.handleMessage("userA", sub("r2", SITE_B, 1004, ["RES_0"]));
    expect(u.last()).toMatchObject({ type: "error", code: "FORBIDDEN", requestId: "r2" });
    // the previous (authorized) subscription is still the active one
    expect(hub.getSubscription("userA")?.nodeId).toBe(1001);
  });

  it("admin and technician can subscribe to any Site", async () => {
    for (const id of ["admin", "tech"]) {
      const c = mkClient(id);
      hub.addClient(c.c);
      await hub.handleMessage(id, sub("r", SITE_B, 1004, ["RES_1"]));
      expect(c.last()).toMatchObject({ type: "subscribed" });
    }
  });

  it("rejects a Node that does not belong to the requested Site (forged siteId)", async () => {
    const u = mkClient("userA");
    hub.addClient(u.c);
    await hub.handleMessage("userA", sub("r", SITE_A, 1004, ["RES_0"]));
    expect(u.last()).toMatchObject({ type: "error", code: "NODE_SITE_MISMATCH" });
  });

  it("rejects unknown nodes, unconfigured sensors and malformed messages", async () => {
    const a = mkClient("admin");
    hub.addClient(a.c);
    await hub.handleMessage("admin", sub("r", SITE_A, 9999, ["RES_0"]));
    expect(a.last()).toMatchObject({ code: "NODE_NOT_FOUND" });
    await hub.handleMessage("admin", sub("r", SITE_A, 1001, ["Temp"]));
    expect(a.last()).toMatchObject({ code: "INVALID_SENSOR" });
    await hub.handleMessage("admin", sub("r", SITE_A, 1001, ["data.$where"]));
    expect(a.last()).toMatchObject({ code: "INVALID_MESSAGE" });
    await hub.handleMessage("admin", "{nope");
    expect(a.last()).toMatchObject({ code: "INVALID_MESSAGE" });
  });

  it("closes the socket when the session is no longer valid", async () => {
    users.userA.active = false;
    const u = mkClient("userA");
    hub.addClient(u.c);
    await hub.handleMessage("userA", sub("r", SITE_A, 1001, ["RES_0"]));
    expect(u.last()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(u.closed()).toBe(4401);
    users.userA.active = true;
  });

  it("filters events by Node and selected sensors and tags them with the subscription id", async () => {
    const a = mkClient("admin");
    const t = mkClient("tech");
    hub.addClient(a.c);
    hub.addClient(t.c);
    await hub.handleMessage("admin", sub("A1", SITE_A, 1001, ["VMR_R", "VMR_B"]));
    await hub.handleMessage("tech", sub("T1", SITE_B, 1004, ["RES_0"]));
    const delivered = hub.publish(1001, { timestamp: "2026-10-18T05:30:00.000Z", values: { VMR_R: 224, VMR_Y: 212, VMR_B: 210 }, alarm: null });
    expect(delivered).toBe(1);
    expect(a.last()).toEqual({ type: "sensor:update", subscriptionId: "A1", nodeId: 1001, timestamp: "2026-10-18T05:30:00.000Z", values: { VMR_R: 224, VMR_B: 210 } });
    expect(t.msgs.some((m) => m.type === "sensor:update")).toBe(false);
    // message with no selected sensors is not sent at all
    expect(hub.publish(1001, { timestamp: "x", values: { RES_0: 1 }, alarm: 0 })).toBe(0);
  });

  it("switching Nodes replaces the subscription (no duplicates, no stale delivery)", async () => {
    const a = mkClient("admin");
    hub.addClient(a.c);
    await hub.handleMessage("admin", sub("s1", SITE_A, 1001, ["RES_0"]));
    await hub.handleMessage("admin", sub("s2", SITE_B, 1004, ["RES_0"]));
    expect(hub.subscriberCount(1001)).toBe(0);
    expect(hub.subscriberCount(1004)).toBe(1);
    a.msgs.length = 0;
    hub.publish(1001, { timestamp: "t", values: { RES_0: 1 }, alarm: 0 });
    expect(a.msgs).toHaveLength(0);
    hub.publish(1004, { timestamp: "t", values: { RES_0: 2 }, alarm: 0 });
    expect(a.last()).toMatchObject({ subscriptionId: "s2", nodeId: 1004 });
  });

  it("a slower superseded subscribe does not override the newer one", async () => {
    let releaseSlow!: () => void;
    const slowHub = new SubscriptionHub({
      loadUser: async (id) => users[id],
      findNode: async (n) => {
        if (n === 1001) await new Promise<void>((r) => (releaseSlow = r));
        return nodes[n] ?? null;
      },
    });
    const a = mkClient("admin");
    slowHub.addClient(a.c);
    const first = slowHub.handleMessage("admin", sub("old", SITE_A, 1001, ["RES_0"]));
    await new Promise((r) => setTimeout(r, 0));
    await slowHub.handleMessage("admin", sub("new", SITE_B, 1004, ["RES_0"]));
    releaseSlow();
    await first;
    expect(slowHub.getSubscription("admin")).toMatchObject({ requestId: "new", nodeId: 1004 });
  });

  it("unsubscribe and disconnect clean up", async () => {
    const a = mkClient("admin");
    hub.addClient(a.c);
    await hub.handleMessage("admin", sub("s1", SITE_A, 1001, ["RES_0"]));
    await hub.handleMessage("admin", JSON.stringify({ action: "unsubscribe", nodeId: 1001 }));
    expect(a.last()).toEqual({ type: "unsubscribed", nodeId: 1001 });
    expect(hub.subscriberCount(1001)).toBe(0);
    await hub.handleMessage("admin", sub("s2", SITE_A, 1001, ["RES_0"]));
    hub.removeClient("admin");
    expect(hub.subscriberCount(1001)).toBe(0);
    expect(hub.clientCount()).toBe(0);
  });

  it("disabling live delivery drops subscriptions and rejects new ones", async () => {
    const a = mkClient("admin");
    hub.addClient(a.c);
    await hub.handleMessage("admin", sub("s1", SITE_A, 1001, ["RES_0"]));
    hub.setLiveEnabled(false);
    expect(a.msgs).toContainEqual({ type: "unsubscribed", nodeId: 1001, reason: "LIVE_DISABLED" });
    expect(hub.publish(1001, { timestamp: "t", values: { RES_0: 1 }, alarm: 0 })).toBe(0);
    await hub.handleMessage("admin", sub("s2", SITE_A, 1001, ["RES_0"]));
    expect(a.last()).toMatchObject({ code: "LIVE_DISABLED" });
  });

  it("broadcasts MQTT status changes", () => {
    const a = mkClient("admin");
    hub.addClient(a.c);
    hub.setMqttStatus("connected");
    expect(a.last()).toEqual({ type: "status", mqtt: "connected", liveEnabled: true });
  });

  it("rate limits chatty clients", async () => {
    const h = new SubscriptionHub({ loadUser: async (id) => users[id], findNode: async () => null }, { maxMessagesPer10s: 3 });
    const a = mkClient("admin");
    h.addClient(a.c);
    for (let i = 0; i < 4; i++) await h.handleMessage("admin", JSON.stringify({ action: "ping" }));
    expect(a.last()).toMatchObject({ code: "RATE_LIMITED" });
  });
});
