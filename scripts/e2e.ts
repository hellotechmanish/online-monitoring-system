/**
 * End-to-end test against RUNNING services (no hardware required):
 *   - Next.js app      (E2E_BASE_URL, default http://localhost:3000)
 *   - realtime service (E2E_WS_URL,   default ws://localhost:3001)
 *   - an MQTT broker   (MQTT_URL — e.g. `npm run mqtt:local-broker`)
 *   - MongoDB          (MONGODB_URI)
 * Requires ADMIN_USERNAME / ADMIN_PASSWORD of the bootstrapped admin.
 * MQTT messages are synthetic protocol-format test inputs.
 *
 *   npm run e2e
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);
import mqtt from "mqtt";
import WebSocket from "ws";
import mongoose from "mongoose";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const WS_BASE = process.env.E2E_WS_URL ?? "ws://localhost:3001";
const TOPIC = process.env.MQTT_TOPIC || "b25saW5lcmVzbW9uaXRvcg==";
const RUN = Date.now().toString(36).slice(-5);
const NODE_A = 100000 + Math.floor(Math.random() * 800000);
const NODE_B = NODE_A + 1;

let pass = 0;
const failures: string[] = [];
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(
      `  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`,
    );
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  cookie = "";
  constructor(public label: string) {}
  async req(
    method: string,
    path: string,
    body?: unknown,
    opts: { origin?: string | null } = {},
  ) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const origin = opts.origin === undefined ? BASE : opts.origin;
    if (origin) headers.origin = origin;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = /derms_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `derms_session=${m[1]}` : "";
    }
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* not json */
    }
    return { status: res.status, json };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  async login(username: string, password: string) {
    return this.post("/api/auth/login", { username, password });
  }
}

interface WsConn {
  ws: WebSocket;
  msgs: any[];
  waitFor(pred: (m: any) => boolean, ms?: number): Promise<any | null>;
  send(o: unknown): void;
}
async function openWs(
  c: Client,
  tokenOverride?: string,
): Promise<WsConn | { error: string }> {
  let token = tokenOverride;
  if (token === undefined) {
    const t = await c.get("/api/realtime/token");
    token = t.json?.token;
  }
  return new Promise((resolve) => {
    const ws = new WebSocket(
      `${WS_BASE}/?token=${encodeURIComponent(token ?? "")}`,
      { headers: { origin: BASE } },
    );
    const msgs: any[] = [];
    const waiters: Array<{ pred: (m: any) => boolean; res: (m: any) => void }> =
      [];
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      msgs.push(m);
      for (const w of [...waiters])
        if (w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.res(m);
        }
    });
    ws.on("open", () =>
      resolve({
        ws,
        msgs,
        send: (o) => ws.send(JSON.stringify(o)),
        waitFor: (pred, ms = 4000) =>
          new Promise((res) => {
            const found = msgs.find(pred);
            if (found) return res(found);
            const w = { pred, res };
            waiters.push(w);
            setTimeout(() => {
              const i = waiters.indexOf(w);
              if (i > -1) {
                waiters.splice(i, 1);
                res(null);
              }
            }, ms);
          }),
      }),
    );
    ws.on("unexpected-response", (_req, res) =>
      resolve({ error: `HTTP ${res.statusCode}` }),
    );
    ws.on("error", (e) => resolve({ error: e.message }));
  });
}
const isConn = (x: WsConn | { error: string }): x is WsConn => "ws" in x;

async function main() {
  const adminUser = process.env.ADMIN_USERNAME!;
  const adminPass = process.env.ADMIN_PASSWORD!;
  await mongoose.connect(process.env.MONGODB_URI!);
  const db = mongoose.connection.db!;
  const admin = new Client("admin");
  const anon = new Client("anon");

  console.log("\n# Authentication");
  check(
    "unauthenticated API request is rejected (401)",
    (await anon.get("/api/sites")).status === 401,
  );
  const page = await fetch(`${BASE}/sites`, { redirect: "manual" });
  check(
    "unauthenticated page redirects to /login",
    page.status === 307 &&
      (page.headers.get("location") ?? "").includes("/login"),
  );
  const bad = await anon.login(adminUser, "wrong-password");
  check(
    "wrong password → 401 generic message",
    bad.status === 401 &&
      bad.json?.error?.message === "Invalid username or password",
    bad,
  );
  const unknownUser = await anon.login("nobody_" + RUN, "whatever123");
  check(
    "unknown username → same generic message",
    unknownUser.status === 401 &&
      unknownUser.json?.error?.message === "Invalid username or password",
  );
  const ok = await admin.login(adminUser.toUpperCase(), adminPass);
  check(
    "admin signs in with username (case-insensitive) + password",
    ok.status === 200 && ok.json?.user?.role === "admin",
    ok,
  );
  check(
    "login response contains no password hash",
    !JSON.stringify(ok.json).includes("passwordHash"),
  );
  const csrf = await admin.req(
    "POST",
    "/api/sites",
    { siteCode: "X", siteName: "X" },
    { origin: "https://evil.example" },
  );
  check("cross-origin POST is rejected (CSRF, 403)", csrf.status === 403, csrf);
  check(
    "current-user endpoint",
    (await admin.get("/api/auth/me")).json?.user?.username ===
      adminUser.toLowerCase(),
  );

  console.log("\n# Sites");
  const sa = await admin.post("/api/sites", {
    siteCode: `e2e-a-${RUN}`,
    siteName: "E2E Building A",
    location: "Greater Noida",
  });
  const sb = await admin.post("/api/sites", {
    siteCode: `E2E-B-${RUN}`,
    siteName: "E2E Building B",
  });
  check(
    "admin creates Sites (code normalized to upper case)",
    sa.status === 201 &&
      sa.json.site.siteCode === `E2E-A-${RUN}`.toUpperCase() &&
      sb.status === 201,
    sa,
  );
  const SITE_A = sa.json.site.id as string;
  const SITE_B = sb.json.site.id as string;
  const dupSite = await admin.post("/api/sites", {
    siteCode: `E2E-A-${RUN}`,
    siteName: "dup",
  });
  check(
    "duplicate Site code → 409",
    dupSite.status === 409 &&
      dupSite.json?.error?.message === "Site code already exists",
    dupSite,
  );
  const upd = await admin.patch(`/api/sites/${SITE_A}`, {
    siteName: "E2E Building A (edited)",
    status: "active",
  });
  check(
    "admin updates Site details",
    upd.status === 200 && upd.json.site.siteName === "E2E Building A (edited)",
    upd,
  );
  check(
    "Site update rejects unknown fields",
    (await admin.patch(`/api/sites/${SITE_A}`, { _id: "x" })).status === 400,
  );

  console.log("\n# Nodes");
  const sensors = [
    {
      sensorType: "RES",
      quantity: 2,
      thresholds: { low: 0.01, high: 10 },
      overrides: [{ sensorId: "RES_1", low: null, high: 5 }],
    },
    { sensorType: "NER", quantity: 2, thresholds: { low: 0, high: 1 } },
    { sensorType: "VMR", quantity: 3, thresholds: {} },
    { sensorType: "SPD", quantity: 3, thresholds: {} },
    { sensorType: "TEMP", quantity: 1, thresholds: { low: 10, high: 40 } },
    { sensorType: "HUM", quantity: 1 },
  ];
  const na = await admin.post("/api/nodes", {
    nodeId: String(NODE_A),
    nodeName: "EQ",
    siteId: SITE_A,
    sensors,
    ipAddress: "10.0.0.5",
  });
  check(
    "Node created under a valid Site with 6 sensor configs",
    na.status === 201 &&
      na.json.node.siteId === SITE_A &&
      na.json.node.sensors.length === 6,
    na,
  );
  const NODE_A_ID = na.json?.node?.id;
  const rawNode = await db.collection("nodes").findOne({ nodeId: NODE_A });
  check(
    "no IP address stored on the Node",
    rawNode && !("ipAddress" in rawNode),
  );
  check(
    "Node starts offline with no discovered channels",
    rawNode?.status === "offline" &&
      (rawNode?.discoveredSensors ?? []).length === 0,
  );
  const nb = await admin.post("/api/nodes", {
    nodeId: NODE_B,
    nodeName: "B-EQ",
    siteId: SITE_B,
    sensors: [{ sensorType: "RES", quantity: 2 }],
  });
  check("second Node created in Site B", nb.status === 201, nb);
  const dup = await admin.post("/api/nodes", {
    nodeId: NODE_A,
    nodeName: "dup",
    siteId: SITE_A,
    sensors: [],
  });
  check(
    "duplicate Node ID → 409 'Node ID already exists'",
    dup.status === 409 && dup.json?.error?.message === "Node ID already exists",
    dup,
  );
  const badSite = await admin.post("/api/nodes", {
    nodeId: NODE_A + 50,
    nodeName: "x",
    siteId: "0123456789abcdef01234567",
    sensors: [],
  });
  check(
    "non-existent Site → 400 'Please select a valid Site'",
    badSite.status === 400 &&
      badSite.json?.error?.message === "Please select a valid Site",
    badSite,
  );
  const noSite = await admin.post("/api/nodes", {
    nodeId: NODE_A + 51,
    nodeName: "x",
    siteId: "",
    sensors: [],
  });
  check(
    "empty Site → 400 'Please select a valid Site'",
    noSite.status === 400 &&
      noSite.json?.error?.message === "Please select a valid Site",
    noSite,
  );
  const q0 = await admin.post("/api/nodes", {
    nodeId: NODE_A + 52,
    nodeName: "x",
    siteId: SITE_A,
    sensors: [{ sensorType: "RES", quantity: 0 }],
  });
  check(
    "quantity 0 → 400 'Sensor quantity must be greater than zero'",
    q0.status === 400 &&
      q0.json?.error?.message === "Sensor quantity must be greater than zero",
    q0,
  );
  const concurrent = await Promise.all(
    [0, 1, 2].map(() =>
      admin.post("/api/nodes", {
        nodeId: NODE_A + 60,
        nodeName: "race",
        siteId: SITE_A,
        sensors: [],
      }),
    ),
  );
  check(
    "concurrent duplicate Node creation: exactly one succeeds",
    concurrent.filter((r) => r.status === 201).length === 1 &&
      concurrent.filter((r) => r.status === 409).length === 2,
    concurrent.map((r) => r.status),
  );
  const siteDetail = await admin.get(`/api/sites/${SITE_A}`);
  check(
    "Site detail lists only its own Nodes",
    siteDetail.json.nodes.every((n: any) => n.siteId === SITE_A) &&
      siteDetail.json.nodes.some((n: any) => n.nodeId === NODE_A) &&
      !siteDetail.json.nodes.some((n: any) => n.nodeId === NODE_B),
  );
  check(
    "Site list includes node counts",
    (await admin.get(`/api/sites?q=${RUN}`)).json.items.find(
      (s: any) => s.id === SITE_A,
    )?.nodeCount === siteDetail.json.nodes.length &&
      siteDetail.json.nodes.length === 2,
  );
  check(
    "Node ID cannot be changed",
    (await admin.patch(`/api/nodes/${NODE_A_ID}`, { nodeId: 5 })).status ===
      400,
  );

  console.log("\n# Users & RBAC");
  const tPass = "Tech-Pass-2026";
  const uPass = "User-Pass-2026";
  const tech = await admin.post("/api/users", {
    name: "E2E Tech",
    username: `tech_${RUN}`,
    password: tPass,
    role: "technician",
  });
  const user = await admin.post("/api/users", {
    name: "E2E User",
    username: `User_${RUN}`,
    password: uPass,
    role: "user",
    assignedSites: [SITE_A],
  });
  check(
    "admin creates Technician and User (username normalized)",
    tech.status === 201 &&
      user.status === 201 &&
      user.json.user.username === `user_${RUN}`,
    [tech, user],
  );
  check(
    "created user response has no password hash",
    !JSON.stringify(user.json).includes("passwordHash"),
  );
  const dupUser = await admin.post("/api/users", {
    name: "x",
    username: `user_${RUN}`,
    password: uPass,
    role: "user",
  });
  check(
    "duplicate username → 409",
    dupUser.status === 409 &&
      dupUser.json?.error?.message === "Username already exists",
    dupUser,
  );
  const race = await Promise.all(
    [0, 1, 2].map(() =>
      admin.post("/api/users", {
        name: "r",
        username: `race_${RUN}`,
        password: uPass,
        role: "user",
      }),
    ),
  );
  check(
    "concurrent duplicate username: exactly one succeeds",
    race.filter((r) => r.status === 201).length === 1,
    race.map((r) => r.status),
  );
  check(
    "admin cannot create another admin via API",
    (
      await admin.post("/api/users", {
        name: "x",
        username: `adm_${RUN}`,
        password: uPass,
        role: "admin",
      })
    ).status === 400,
  );

  const tc = new Client("tech");
  check(
    "technician signs in",
    (await tc.login(`tech_${RUN}`, tPass)).status === 200,
  );
  check(
    "technician sees all Sites",
    (await tc.get(`/api/sites/${SITE_B}`)).status === 200,
  );
  check(
    "technician cannot edit Sites (403)",
    (await tc.patch(`/api/sites/${SITE_A}`, { siteName: "hack" })).status ===
      403,
  );
  const tn = await tc.post("/api/nodes", {
    nodeId: NODE_A + 70,
    nodeName: "x",
    siteId: SITE_A,
    sensors: [],
  });
  check(
    "technician cannot create Nodes (403 message)",
    tn.status === 403 &&
      tn.json?.error?.message === "You do not have permission to create Nodes",
    tn,
  );
  check(
    "technician cannot edit Nodes (403)",
    (await tc.patch(`/api/nodes/${NODE_A_ID}`, { nodeName: "hack" })).status ===
      403,
  );
  check(
    "technician cannot change Global Settings (403)",
    (await tc.patch("/api/settings", { projectTitle: "hack" })).status === 403,
  );
  check(
    "technician cannot create technicians (403)",
    (
      await tc.post("/api/users", {
        name: "x",
        username: `t2_${RUN}`,
        password: uPass,
        role: "technician",
      })
    ).status === 403,
  );
  const tu = await tc.post("/api/users", {
    name: "Tech-made",
    username: `tm_${RUN}`,
    password: uPass,
    role: "user",
  });
  check("technician creates a User", tu.status === 201, tu);
  check(
    "technician assigns Sites to a User",
    (
      await tc.patch(`/api/users/${tu.json.user.id}/assign-sites`, {
        assignedSites: [SITE_B],
      })
    ).status === 200,
  );
  check(
    "technician cannot promote a User to technician",
    (await tc.patch(`/api/users/${tu.json.user.id}`, { role: "technician" }))
      .status === 403,
  );
  check(
    "technician cannot edit a technician account",
    (await tc.patch(`/api/users/${tech.json.user.id}`, { name: "x" }))
      .status === 403,
  );

  const uc = new Client("user");
  check("user signs in", (await uc.login(`user_${RUN}`, uPass)).status === 200);
  const uSites = await uc.get("/api/sites?limit=100");
  check(
    "user sees only assigned Sites",
    uSites.json.items.length === 1 && uSites.json.items[0].id === SITE_A,
    uSites.json.items.map((s: any) => s.siteCode),
  );
  check(
    "user cannot open another Site by ID (403)",
    (await uc.get(`/api/sites/${SITE_B}`)).status === 403,
  );
  check(
    "user cannot list another Site's Nodes via siteId param (403)",
    (await uc.get(`/api/nodes?siteId=${SITE_B}`)).status === 403,
  );
  check(
    "user Node list contains only assigned-Site Nodes",
    (await uc.get("/api/nodes?limit=100")).json.items.every(
      (n: any) => n.siteId === SITE_A,
    ),
  );
  check(
    "user cannot read another Site's Node by ID (403)",
    (await uc.get(`/api/nodes/${nb.json.node.id}`)).status === 403,
  );
  check(
    "user cannot read history of another Site's Node (403)",
    (await uc.get(`/api/readings/history?nodeId=${NODE_B}&sensors=RES_0`))
      .status === 403,
  );
  check(
    "user cannot read raw readings of another Site's Node (403)",
    (await uc.get(`/api/readings?nodeId=${NODE_B}`)).status === 403,
  );
  check(
    "user cannot manage users (403)",
    (await uc.get("/api/users")).status === 403,
  );
  check(
    "user cannot create Sites (403)",
    (await uc.post("/api/sites", { siteCode: "U1", siteName: "x" })).status ===
      403,
  );
  const nav = await uc.get("/api/monitoring/nav");
  check(
    "monitoring nav for user contains only assigned Sites with their Nodes",
    nav.json.items.length === 1 &&
      nav.json.items[0].nodes.some((n: any) => n.nodeId === NODE_A),
  );

  console.log("\n# Global Settings");
  const s1 = await admin.patch("/api/settings", {
    databaseSaveIntervalSeconds: 2,
    liveChart: { maxPoints: 20 },
  });
  check(
    "admin updates settings (partial liveChart merge keeps other fields)",
    s1.status === 200 &&
      s1.json.settings.databaseSaveIntervalSeconds === 2 &&
      s1.json.settings.liveChart.reconnectIntervalSeconds === 3,
    s1,
  );
  check(
    "invalid setting rejected",
    (await admin.patch("/api/settings", { databaseSaveIntervalSeconds: 0 }))
      .status === 400,
  );
  await sleep(3500);
  const health1 = await (
    await fetch(WS_BASE.replace("ws", "http") + "/health")
  ).json();
  check(
    "realtime service applied new save interval without restart",
    health1.saveIntervalSeconds === 2,
    health1,
  );

  console.log("\n# WebSocket authentication & authorization");
  const noTok = await openWs(uc, "");
  check("WebSocket without token is rejected", !isConn(noTok));
  const forged = await openWs(
    uc,
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid",
  );
  check("WebSocket with forged token is rejected", !isConn(forged));
  const tokRes = await uc.get("/api/realtime/token");
  const first = await openWs(uc, tokRes.json.token);
  const reuse = await openWs(uc, tokRes.json.token);
  check("WebSocket token is single-use", isConn(first) && !isConn(reuse));
  if (isConn(first)) first.ws.close();

  const uws = await openWs(uc);
  const aws = await openWs(admin);
  if (!isConn(uws) || !isConn(aws))
    throw new Error("WebSocket connection failed");
  check(
    "hello reports MQTT connected",
    !!(await uws.waitFor(
      (m) => m.type === "hello" && m.status.mqtt === "connected",
    )),
  );
  uws.send({
    action: "subscribe",
    requestId: "u-forbidden",
    siteId: SITE_B,
    nodeId: NODE_B,
    sensors: ["RES_0"],
  });
  check(
    "user subscription to unassigned Site → FORBIDDEN",
    !!(await uws.waitFor(
      (m) => m.requestId === "u-forbidden" && m.code === "FORBIDDEN",
    )),
  );
  uws.send({
    action: "subscribe",
    requestId: "u-forged",
    siteId: SITE_A,
    nodeId: NODE_B,
    sensors: ["RES_0"],
  });
  check(
    "forged siteId/nodeId pairing → NODE_SITE_MISMATCH",
    !!(await uws.waitFor(
      (m) => m.requestId === "u-forged" && m.code === "NODE_SITE_MISMATCH",
    )),
  );
  uws.send({
    action: "subscribe",
    requestId: "u-badsensor",
    siteId: SITE_A,
    nodeId: NODE_A,
    sensors: ["GN_0"],
  });
  check(
    "unconfigured sensor subscription → INVALID_SENSOR",
    !!(await uws.waitFor(
      (m) => m.requestId === "u-badsensor" && m.code === "INVALID_SENSOR",
    )),
  );
  uws.send({
    action: "subscribe",
    requestId: "u1",
    siteId: SITE_A,
    nodeId: NODE_A,
    sensors: ["RES_0", "RES_1"],
  });
  check(
    "user subscribes to assigned Node",
    !!(await uws.waitFor(
      (m) => m.type === "subscribed" && m.requestId === "u1",
    )),
  );
  aws.send({
    action: "subscribe",
    requestId: "a1",
    siteId: SITE_B,
    nodeId: NODE_B,
    sensors: ["RES_0"],
  });
  check(
    "admin subscribes to Site B Node",
    !!(await aws.waitFor(
      (m) => m.type === "subscribed" && m.requestId === "a1",
    )),
  );

  console.log("\n# MQTT ingestion → WebSocket");
  const mq = await mqtt.connectAsync(process.env.MQTT_URL!);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
  const pub = (nodeId: number, data: unknown) =>
    mq.publishAsync(
      TOPIC,
      JSON.stringify({ Node_Id: nodeId, data: b64(data) }),
      { qos: 1 },
    );
  const before = (
    await (await fetch(WS_BASE.replace("ws", "http") + "/health")).json()
  ).ingest;
  await pub(NODE_A, { initialStart: 1 });
  await pub(NODE_A, { RES_0: 4, alarm: 0, start: 1 });
  await pub(NODE_A, { RES_1: 0, alarm: 0, start: 1 });
  await pub(NODE_A, { NER_0: 0.704, alarm: 0, start: 1 });
  await pub(NODE_A, { VMR_R: 224, VMR_Y: 212, VMR_B: 210, start: 1 });
  await pub(NODE_A, { Temp: 31.8, Hum: 55.8, start: 1 });
  await pub(NODE_A, { end: 1 });
  await pub(999_999_999, { RES_0: 1, start: 1 });
  await mq.publishAsync(TOPIC, "this is not json", { qos: 1 });
  await mq.publishAsync(
    TOPIC,
    JSON.stringify({ Node_Id: NODE_A, data: "@@not-base64@@" }),
    { qos: 1 },
  );
  const e1 = await uws.waitFor(
    (m) => m.type === "sensor:update" && "RES_0" in m.values,
  );
  check(
    "user receives RES_0 update with server timestamp and alarm",
    e1 &&
      e1.nodeId === NODE_A &&
      e1.values.RES_0 === 4 &&
      e1.alarm === 0 &&
      !Number.isNaN(Date.parse(e1.timestamp)) &&
      e1.subscriptionId === "u1",
    e1,
  );
  const e2 = await uws.waitFor(
    (m) => m.type === "sensor:update" && "RES_1" in m.values,
  );
  check("user receives RES_1 update", e2?.values.RES_1 === 0, e2);
  await sleep(500);
  const userUpdates = uws.msgs.filter((m) => m.type === "sensor:update");
  check(
    "user receives only selected sensors (no NER/VMR/Temp)",
    userUpdates.every((m) =>
      Object.keys(m.values).every((k) => k === "RES_0" || k === "RES_1"),
    ),
    userUpdates,
  );
  check(
    "admin subscribed to another Node receives none of these",
    !aws.msgs.some((m) => m.type === "sensor:update"),
  );
  const after = (
    await (await fetch(WS_BASE.replace("ws", "http") + "/health")).json()
  ).ingest;
  check(
    "unknown Node rejected",
    after.unknownNode - before.unknownNode === 1,
    after,
  );
  check(
    "malformed messages rejected safely",
    after.malformed - before.malformed === 2,
    after,
  );
  await pub(NODE_B, { RES_0: 7, alarm: 1, start: 1 });
  const ea = await aws.waitFor((m) => m.type === "sensor:update");
  check(
    "admin receives its Node's update",
    ea?.nodeId === NODE_B && ea.values.RES_0 === 7 && ea.alarm === 1,
    ea,
  );

  uws.send({
    action: "subscribe",
    requestId: "u2",
    siteId: SITE_A,
    nodeId: NODE_A,
    sensors: ["VMR_R", "VMR_B"],
  });
  await uws.waitFor((m) => m.type === "subscribed" && m.requestId === "u2");
  const mark = uws.msgs.length;
  await pub(NODE_A, { RES_0: 5, alarm: 0, start: 1 });
  await pub(NODE_A, { VMR_R: 225, VMR_Y: 213, VMR_B: 211, start: 1 });
  const ev = await uws.waitFor(
    (m) => m.type === "sensor:update" && m.subscriptionId === "u2",
  );
  await sleep(300);
  const sinceSwitch = uws.msgs
    .slice(mark)
    .filter((m) => m.type === "sensor:update");
  check(
    "after switching sensors only the new selection is delivered",
    ev &&
      ev.values.VMR_R === 225 &&
      ev.values.VMR_B === 211 &&
      !("VMR_Y" in ev.values) &&
      sinceSwitch.every(
        (m) => m.subscriptionId === "u2" && !("RES_0" in m.values),
      ),
    sinceSwitch,
  );

  console.log("\n# Persistence (GlobalSetting interval) & history");
  await sleep(2600);
  const stored = await db
    .collection("sensorreadings")
    .find({ nodeId: NODE_A })
    .toArray();
  const resDoc = stored
    .filter((d) => "RES_0" in d.data)
    .sort((a, b) => +b.receivedAt - +a.receivedAt)[0];
  check(
    "readings persisted on the configured interval",
    stored.length > 0,
    stored.length,
  );
  check(
    "stored document preserves the original decoded payload",
    resDoc &&
      JSON.stringify(Object.keys(resDoc.data).sort()) ===
        JSON.stringify(["RES_0", "alarm", "start"]) &&
      resDoc.data.RES_0 === 5,
    resDoc?.data,
  );
  check(
    "stored document references the registered Node",
    resDoc &&
      resDoc.nodeRef.toString() === NODE_A_ID &&
      resDoc.receivedAt instanceof Date,
  );
  check(
    "snapshot policy: at most one RES_0 document per save interval (2 RES_0 messages, ≤2 docs)",
    stored.filter((d) => "RES_0" in d.data).length <= 2,
  );
  check(
    "control messages are not stored as readings (snapshot mode)",
    !stored.some((d) => "initialStart" in d.data || "end" in d.data),
  );
  check(
    "unknown Node's readings were not stored",
    (await db
      .collection("sensorreadings")
      .countDocuments({ nodeId: 999_999_999 })) === 0,
  );

  // Seed a longer persisted history directly (simulates past save cycles) to test the history API.
  const nodeRef = new mongoose.Types.ObjectId(NODE_A_ID);
  const t0 = Date.now() - 600_000;
  await db
    .collection("sensorreadings")
    .insertMany([
      ...Array.from({ length: 30 }, (_, i) => ({
        nodeId: NODE_A,
        nodeRef,
        data: { RES_0: 100 + i, alarm: 0, start: 1 },
        receivedAt: new Date(t0 + i * 5000),
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        nodeId: NODE_A,
        nodeRef,
        data: { RES_1: 200 + i, alarm: 0, start: 1 },
        receivedAt: new Date(t0 - 100_000 + i * 5000),
      })),
    ]);
  const hist = await uc.get(
    `/api/readings/history?nodeId=${NODE_A}&sensors=RES_0,RES_1&limit=20`,
  );
  const pts = hist.json?.points ?? [];
  const r0 = pts
    .filter((p: any) => "RES_0" in p.values)
    .map((p: any) => p.values.RES_0);
  const r1 = pts.filter((p: any) => "RES_1" in p.values);
  check(
    "history returns 20 latest RES_0 points",
    r0.length === 20 && r0[r0.length - 1] === 5,
    r0,
  );
  check(
    "sparse/older RES_1 series still gets its points (per-sensor limit)",
    r1.length === 5,
    r1.length,
  );
  const times = pts.map((p: any) => Date.parse(p.timestamp));
  check(
    "history is ordered oldest → newest",
    times.every((t: number, i: number) => i === 0 || t >= times[i - 1]),
  );
  check(
    "history points contain only requested sensors",
    pts.every((p: any) =>
      Object.keys(p.values).every((k) => k === "RES_0" || k === "RES_1"),
    ),
  );
  check(
    "history rejects invalid sensor IDs",
    (await uc.get(`/api/readings/history?nodeId=${NODE_A}&sensors=data.$where`))
      .status === 400,
  );
  check(
    "history for unknown Node → 404",
    (await admin.get(`/api/readings/history?nodeId=987654321&sensors=RES_0`))
      .status === 404,
  );
  const emptyHist = await admin.get(
    `/api/readings/history?nodeId=${NODE_A}&sensors=NER_1`,
  );
  check(
    "empty history returns an empty list",
    emptyHist.status === 200 && emptyHist.json.points.length === 0,
  );

  console.log("\n# Node configuration changes keep history");
  const countBefore = await db
    .collection("sensorreadings")
    .countDocuments({ nodeId: NODE_A });
  const edited = await admin.patch(`/api/nodes/${NODE_A_ID}`, {
    nodeName: "EQ-renamed",
    sensors: sensors.filter(
      (s) => s.sensorType !== "HUM" && s.sensorType !== "RES",
    ),
  });
  check(
    "admin edits Node name and sensor configuration",
    edited.status === 200 &&
      edited.json.node.nodeName === "EQ-renamed" &&
      edited.json.node.sensors.length === 4,
    edited,
  );
  check(
    "historical readings preserved after configuration change",
    (await db
      .collection("sensorreadings")
      .countDocuments({ nodeId: NODE_A })) === countBefore,
  );
  await admin.patch(`/api/nodes/${NODE_A_ID}`, { sensors });

  console.log("\n# Node discovery & status (activity tick every 15 s)");
  await sleep(15_500);
  const nd = await admin.get(`/api/nodes/${NODE_A_ID}`);
  check(
    "discovered channels recorded from real messages only",
    ["RES_0", "RES_1", "NER_0", "VMR_R", "VMR_Y", "VMR_B", "Temp", "Hum"].every(
      (s) => nd.json.node.discoveredSensors.includes(s),
    ) &&
      !nd.json.node.discoveredSensors.includes("NER_1") &&
      !nd.json.node.discoveredSensors.includes("SPD_R"),
    nd.json.node.discoveredSensors,
  );
  check(
    "discovered channels in stable order",
    nd.json.node.discoveredSensors.join(",") ===
      "RES_0,RES_1,NER_0,VMR_R,VMR_Y,VMR_B,Temp,Hum",
    nd.json.node.discoveredSensors,
  );
  check(
    "Node marked online with lastReadingAt",
    nd.json.node.status === "online" && !!nd.json.node.lastReadingAt,
    nd.json.node,
  );

  console.log("\n# Live delivery switch & session revocation");
  await admin.patch("/api/settings", { liveChart: { enabled: false } });
  check(
    "disabling live chart drops subscriptions (LIVE_DISABLED)",
    !!(await uws.waitFor(
      (m) => m.type === "unsubscribed" && m.reason === "LIVE_DISABLED",
      5000,
    )),
  );
  await admin.patch("/api/settings", {
    liveChart: { enabled: true },
    databaseSaveIntervalSeconds: 5,
  });
  await sleep(2500);
  check(
    "deactivating a user",
    (await admin.patch(`/api/users/${user.json.user.id}`, { isActive: false }))
      .status === 200,
  );
  check(
    "deactivated user's existing session is rejected",
    (await uc.get("/api/sites")).status === 401,
  );
  uws.send({
    action: "subscribe",
    requestId: "u3",
    siteId: SITE_A,
    nodeId: NODE_A,
    sensors: ["RES_0"],
  });
  check(
    "deactivated user's WebSocket subscription is rejected",
    !!(await uws.waitFor(
      (m) => m.requestId === "u3" && m.code === "UNAUTHENTICATED",
    )),
  );
  check(
    "deactivated user cannot sign in",
    (await new Client("x").login(`user_${RUN}`, uPass)).status === 403,
  );

  console.log("\n# Bootstrap idempotency");
  check(
    "exactly one admin exists although bootstrap ran in two processes",
    (await db.collection("users").countDocuments({ role: "admin" })) === 1,
  );
  check(
    "exactly one GlobalSetting document",
    (await db.collection("globalsettings").countDocuments({})) === 1,
  );

  check(
    "logout clears the session",
    (await admin.post("/api/auth/logout")).status === 200 &&
      (await admin.get("/api/auth/me")).status === 401,
  );

  aws.ws.close();
  uws.ws.close();
  await mq.endAsync();
  await mongoose.disconnect();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("Failed:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error("E2E aborted:", e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
