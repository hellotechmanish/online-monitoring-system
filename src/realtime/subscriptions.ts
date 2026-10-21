import { canAccessSite, can, type SessionUser } from "@/lib/auth/rbac";
import { sensorTypeOf, sortSensorIds, type SensorConfigLike } from "@/lib/protocol/sensors";
import { wsClientMessageSchema } from "@/lib/validation";

/**
 * WebSocket subscription hub (transport-agnostic, unit-testable).
 *
 * Client → server:
 *   { action: "subscribe", requestId, siteId, nodeId, sensors: ["RES_0"] }
 *   { action: "unsubscribe", nodeId? }
 *   { action: "ping" }
 * Server → client:
 *   { type: "hello", user, status }
 *   { type: "status", mqtt, liveEnabled }
 *   { type: "subscribed", requestId, nodeId, siteId, sensors, latest }
 *   { type: "unsubscribed", nodeId }
 *   { type: "sensor:update", subscriptionId, nodeId, timestamp, values, alarm? }
 *   { type: "error", code, message, requestId? }
 *   { type: "pong" }
 *
 * Each connection has at most one active subscription (one Site + one Node at a
 * time); subscribing again replaces it, which prevents duplicate subscriptions.
 * Events are delivered only to clients subscribed to that Node, filtered to the
 * selected sensor IDs, and tagged with the subscription's requestId so the
 * browser can drop late events from an older selection.
 */

export type MqttStatus = "disabled" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface HubNode {
  nodeId: number;
  siteId: string;
  sensors: SensorConfigLike[];
}

export interface HubDeps {
  /** Must reject inactive users and (when `sv` is given) revoked sessions. */
  loadUser(userId: string, sv: number | null): Promise<SessionUser | null>;
  findNode(nodeId: number): Promise<HubNode | null>;
  latest?(nodeId: number, sensors: string[]): Record<string, { value: number; timestamp: string; alarm: number | null }>;
}

export interface HubClient {
  id: string;
  userId: string;
  /** Session version from the connect token; a password change/deactivation revokes the socket. */
  sv?: number;
  user: SessionUser;
  send(msg: Record<string, unknown>): void;
  close?(code?: number, reason?: string): void;
}

interface Subscription {
  requestId: string;
  nodeId: number;
  siteId: string;
  sensors: Set<string>;
}

interface ClientState {
  client: HubClient;
  sub: Subscription | null;
  latestRequestId: string | null;
  msgTimes: number[];
}

export class SubscriptionHub {
  private clients = new Map<string, ClientState>();
  private byNode = new Map<number, Set<string>>();
  private liveEnabled: boolean;
  private mqttStatus: MqttStatus = "disabled";

  constructor(
    private deps: HubDeps,
    opts: { liveEnabled?: boolean; maxMessagesPer10s?: number; now?: () => number } = {},
  ) {
    this.liveEnabled = opts.liveEnabled ?? true;
    this.maxMsgs = opts.maxMessagesPer10s ?? 40;
    this.now = opts.now ?? Date.now;
  }
  private maxMsgs: number;
  private now: () => number;

  status() {
    return { mqtt: this.mqttStatus, liveEnabled: this.liveEnabled };
  }

  addClient(client: HubClient) {
    this.clients.set(client.id, { client, sub: null, latestRequestId: null, msgTimes: [] });
    client.send({
      type: "hello",
      user: { id: client.user.id, username: client.user.username, role: client.user.role },
      status: this.status(),
    });
  }

  removeClient(id: string) {
    const st = this.clients.get(id);
    if (!st) return;
    this.dropSub(st);
    this.clients.delete(id);
  }

  clientCount() {
    return this.clients.size;
  }

  subscriberCount(nodeId: number) {
    return this.byNode.get(nodeId)?.size ?? 0;
  }

  getSubscription(clientId: string) {
    const s = this.clients.get(clientId)?.sub;
    return s ? { ...s, sensors: Array.from(s.sensors) } : null;
  }

  private dropSub(st: ClientState) {
    if (!st.sub) return;
    const set = this.byNode.get(st.sub.nodeId);
    set?.delete(st.client.id);
    if (set && set.size === 0) this.byNode.delete(st.sub.nodeId);
    st.sub = null;
  }

  private error(st: ClientState, code: string, message: string, requestId?: string) {
    st.client.send({ type: "error", code, message, ...(requestId ? { requestId } : {}) });
  }

  setMqttStatus(s: MqttStatus) {
    if (s === this.mqttStatus) return;
    this.mqttStatus = s;
    this.broadcast({ type: "status", ...this.status() });
  }

  /** Live delivery switch from GlobalSetting.liveChart.enabled. Disabling drops all subscriptions. */
  setLiveEnabled(enabled: boolean) {
    if (enabled === this.liveEnabled) return;
    this.liveEnabled = enabled;
    if (!enabled) {
      for (const st of this.clients.values()) {
        if (st.sub) {
          const nodeId = st.sub.nodeId;
          this.dropSub(st);
          st.client.send({ type: "unsubscribed", nodeId, reason: "LIVE_DISABLED" });
        }
      }
    }
    this.broadcast({ type: "status", ...this.status() });
  }

  private broadcast(msg: Record<string, unknown>) {
    for (const st of this.clients.values()) st.client.send(msg);
  }

  private rateLimited(st: ClientState): boolean {
    const now = this.now();
    st.msgTimes = st.msgTimes.filter((t) => now - t < 10_000);
    st.msgTimes.push(now);
    return st.msgTimes.length > this.maxMsgs;
  }

  async handleMessage(clientId: string, raw: string): Promise<void> {
    const st = this.clients.get(clientId);
    if (!st) return;
    if (this.rateLimited(st)) {
      this.error(st, "RATE_LIMITED", "Too many messages");
      if (st.msgTimes.length > this.maxMsgs * 2) st.client.close?.(1008, "rate limit");
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.error(st, "INVALID_MESSAGE", "Message must be valid JSON");
    }
    const parsed = wsClientMessageSchema.safeParse(json);
    if (!parsed.success) return this.error(st, "INVALID_MESSAGE", "Unsupported or malformed message");
    const msg = parsed.data;

    if (msg.action === "ping") return st.client.send({ type: "pong" });

    if (msg.action === "unsubscribe") {
      const nodeId = st.sub?.nodeId ?? msg.nodeId ?? null;
      st.latestRequestId = null;
      this.dropSub(st);
      return st.client.send({ type: "unsubscribed", nodeId });
    }

    // subscribe
    const { requestId, siteId, nodeId } = msg;
    st.latestRequestId = requestId;
    if (!this.liveEnabled) return this.error(st, "LIVE_DISABLED", "Live monitoring is disabled in Global Settings", requestId);

    // Re-load the user so revoked access / deactivation applies immediately.
    const user = await this.deps.loadUser(st.client.userId, st.client.sv ?? null);
    if (!user) {
      this.error(st, "UNAUTHENTICATED", "Session is no longer valid", requestId);
      st.client.close?.(4401, "unauthenticated");
      return;
    }
    st.client.user = user;
    if (!can(user, "monitoring:view")) return this.error(st, "FORBIDDEN", "Not allowed", requestId);

    const node = await this.deps.findNode(nodeId);
    if (st.latestRequestId !== requestId) return; // superseded by a newer subscribe while awaiting
    if (!node) return this.error(st, "NODE_NOT_FOUND", "Node not found", requestId);
    if (node.siteId !== siteId) return this.error(st, "NODE_SITE_MISMATCH", "Node does not belong to the requested Site", requestId);
    if (!canAccessSite(user, siteId)) return this.error(st, "FORBIDDEN", "You do not have access to this Site", requestId);

    const configured = new Set(node.sensors.map((s) => s.sensorType));
    const invalid = msg.sensors.filter((s) => {
      const t = sensorTypeOf(s);
      return !t || !configured.has(t);
    });
    if (invalid.length) {
      return this.error(st, "INVALID_SENSOR", `Sensor not configured on this Node: ${invalid.join(", ")}`, requestId);
    }

    this.dropSub(st);
    const sensors = sortSensorIds(msg.sensors);
    st.sub = { requestId, nodeId, siteId, sensors: new Set(sensors) };
    if (!this.byNode.has(nodeId)) this.byNode.set(nodeId, new Set());
    this.byNode.get(nodeId)!.add(st.client.id);
    st.client.send({
      type: "subscribed",
      requestId,
      nodeId,
      siteId,
      sensors,
      latest: this.deps.latest?.(nodeId, sensors) ?? {},
    });
  }

  /** Delivers one ingested message to subscribed, authorized clients (filtered by sensor). */
  publish(nodeId: number, event: { timestamp: string; values: Record<string, number>; alarm: number | null }): number {
    if (!this.liveEnabled) return 0;
    const ids = this.byNode.get(nodeId);
    if (!ids) return 0;
    let delivered = 0;
    for (const id of ids) {
      const st = this.clients.get(id);
      if (!st?.sub) continue;
      const values: Record<string, number> = {};
      let any = false;
      for (const [k, v] of Object.entries(event.values)) {
        if (st.sub.sensors.has(k)) {
          values[k] = v;
          any = true;
        }
      }
      if (!any) continue;
      st.client.send({
        type: "sensor:update",
        subscriptionId: st.sub.requestId,
        nodeId,
        timestamp: event.timestamp,
        values,
        ...(event.alarm !== null ? { alarm: event.alarm } : {}),
      });
      delivered++;
    }
    return delivered;
  }
}
