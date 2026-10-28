# DERMS — Online Resistance Monitoring System

Next.js 14 (App Router, TypeScript strict) CRM for Sites, Nodes, sensor configuration, users and settings, plus a separate Node.js **realtime service** that consumes MQTT, validates readings against registered Nodes, streams them over an authenticated WebSocket and persists them to MongoDB on a configurable interval.

```
IoT devices / Python poller ──► MQTT broker ──► realtime service (src/realtime, ONE instance)
                                                 │  validate envelope → decode → verify Node in MongoDB
                                                 │  → latest-value cache → WebSocket (per Node / per sensor, authorized)
                                                 │                                   └──► browser /monitoring (Recharts)
                                                 └─ PersistenceWorker (GlobalSetting.databaseSaveIntervalSeconds) ──► MongoDB
Next.js app (src/app) ── CRM pages + REST API (/api/*) ── MongoDB
```

The browser never talks to MQTT; MQTT credentials stay in the realtime service.

---

## 1. Quick start (development)

Requirements: Node.js ≥ 18.18 (tested on 22), MongoDB ≥ 6, an MQTT broker (optional — the CRM works without it).

```bash
npm install
cp .env.example .env.local        # fill in values (see §2)
npm run dev                       # Next.js on :3000 + realtime service on :3001
```

Open http://localhost:3000 and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

No broker yet? `npm run mqtt:local-broker` starts a local test broker on `mqtt://127.0.0.1:1883`; set `MQTT_URL` to it and publish synthetic protocol messages for a registered Node with `npx tsx scripts/publish-sample.ts --node 1001`.

## 2. Environment variables

| Variable                                         | Used by  | Purpose                                                          |
| ------------------------------------------------ | -------- | ---------------------------------------------------------------- |
| `MONGODB_URI`                                    | both     | MongoDB connection string (server-only)                          |
| `AUTH_SECRET`                                    | both     | ≥ 32 chars; signs session cookies and WebSocket tokens           |
| `APP_URL`                                        | both     | Public web origin; used for CSRF/Origin checks (web + WebSocket) |
| `ADMIN_NAME`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` | both     | First-run admin bootstrap only (see §4)                          |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`     | realtime | Broker connection. Empty `MQTT_URL` = live data disabled         |
| `MQTT_TOPIC`                                     | realtime | Default `b25saW5lcmVzbW9uaXRvcg==` (the known topic string)      |
| `MQTT_PAYLOAD_ENCODING`                          | realtime | `auto` (default), `base64` or `json` — see §6                    |
| `REALTIME_PORT`                                  | realtime | WebSocket/health port (default 3001)                             |
| `NEXT_PUBLIC_REALTIME_URL`                       | web      | Browser-facing WebSocket URL, e.g. `wss://derms.example.org/ws`  |
| `READING_HISTORY_MODE`                           | realtime | `snapshot` (default) or `raw` — see §7                           |
| `NODE_OFFLINE_AFTER_SECONDS`                     | realtime | Mark a Node offline after this silence (default 120)             |
| `REALTIME_ALLOWED_ORIGINS`                       | realtime | Extra comma-separated origins allowed to open WebSockets         |
| `SETTINGS_POLL_SECONDS`                          | realtime | How often GlobalSetting changes are picked up (default 10)       |

`.env*` files are git-ignored. Never commit real values.

## 3. Production

```bash
npm ci
npm run build
npm run start            # Next.js (port 3000)
npm run start:realtime   # realtime service (port 3001) — a long-running Node.js process
```

- **The realtime service needs a persistent Node.js process.** Standard Next.js route handlers do not support persistent WebSocket upgrades, and serverless platforms cannot host it. Run it under systemd/PM2/a container next to the web app.
- **Run exactly one realtime instance.** It is the only MQTT subscriber; the latest-value cache and subscriptions are in memory. For multiple instances, put a shared bus (e.g. Redis pub/sub) between ingestion and WebSocket fan-out and use a single persistence worker — not implemented here.
- Terminate TLS at a reverse proxy and forward `/ws` (or a sub-domain) to port 3001 with `Upgrade`/`Connection` headers; set `NEXT_PUBLIC_REALTIME_URL=wss://…` and make sure `APP_URL` is the exact public origin.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production` (serve over HTTPS).
- The in-memory login/user-creation rate limiter is per process; use a shared store if you scale the web app horizontally.
- Health: `GET http://<realtime>:3001/health` → MQTT status, client count, pending writes, ingest counters (no secrets).

**Next.js version:** the spec referenced 14.2.15. `npm install` flagged that release as having published security vulnerabilities (including a middleware authorization bypass), so the project pins **14.2.35**, the latest patch of the same 14.2 line (no API changes).

## 4. First-run admin bootstrap

On the first MongoDB connection, either process:

1. ensures indexes exist (unique `siteCode`, `nodeId`, `username`, reading indexes);
2. creates the single `GlobalSetting` (`key: "global"`) **only if missing** (`$setOnInsert`, never overwrites);
3. creates the initial admin from `ADMIN_*` **only if no admin exists**. It never changes an existing admin; if variables are missing it logs a warning and skips.

Verified: both processes bootstrap concurrently and still produce exactly one admin and one settings document.

Production procedure: set `ADMIN_*` for the first start, sign in, change the password under **My Profile**, then remove `ADMIN_PASSWORD` from the environment. There is no HTTP endpoint that creates admins; the API cannot create or promote an admin at all.

### Username migration (accounts from an email-based Phase 1)

Login uses **username** only. If a database contains users without a `username` (e.g. created by an email-based version), bootstrap logs a warning and those accounts cannot sign in until migrated:

```bash
npm run users:migrate-usernames            # dry run: shows proposed usernames
npx tsx scripts/migrate-usernames.ts --apply
```

It derives the username from the email local part, keeps the `email` field, and **reports collisions or invalid candidates instead of assigning duplicates** — set those manually.

## 5. Roles and permissions (enforced server-side on every request and WebSocket subscription)

| Capability                                          |      Admin       |   Technician   |        User         |
| --------------------------------------------------- | :--------------: | :------------: | :-----------------: |
| View Sites / Nodes / readings                       |       all        |      all       | assigned Sites only |
| Create / edit Sites                                 |        ✓         |       –        |          –          |
| Create / edit Nodes, sensor quantities & thresholds |        ✓         |       –        |          –          |
| Create accounts                                     | Technician, User |      User      |          –          |
| Edit / deactivate / reset password                  | Technician, User |      User      |          –          |
| Assign Users to Sites                               |        ✓         | ✓ (Users only) |          –          |
| Global Settings                                     |        ✓         |       –        |          –          |
| Monitoring (live + history)                         |       all        |      all       | assigned Sites only |

Deactivation, role change and password reset increment `sessionVersion`, which revokes existing sessions and open WebSocket subscriptions immediately. Maintenance mode lets only admins sign in or use the API.

## 6. MQTT protocol

Envelope (JSON) on topic `MQTT_TOPIC`:

```json
{ "Node_Id": 1001, "data": "<encoded-payload>" }
```

Decoded payload examples: `{ "initialStart": 1 }`, `{ "RES_0": 4, "alarm": 0, "start": 1 }`, `{ "VMR_R": 224, "VMR_Y": 212, "VMR_B": 210, "start": 1 }`, `{ "Temp": 31.8, "Hum": 55.8, "start": 1 }`, `{ "end": 1 }`.

> **Confirm against the Python publisher.** Its source was not available. The decoder (`src/lib/protocol/decode.ts`) therefore accepts `data` as Base64 of a UTF-8 JSON object (the documented format) and, in `auto` mode, also a JSON object or JSON string. Once confirmed, set `MQTT_PAYLOAD_ENCODING=base64` (or `json`).

Processing (`src/realtime/ingest.ts`):

- Envelope validated (size ≤ 16 KB, numeric positive `Node_Id`); malformed Base64/JSON/shapes are rejected and counted.
- The Node must be **registered in MongoDB**. Unknown IDs are rejected (never auto-created). Site ownership comes only from `Node.siteId`; any site field in the payload is ignored.
- `initialStart`, `start`, `end` are control flags, never readings. `alarm` is kept separately from sensor values.
- Sensor channels recognised: `RES_<n>`, `NER_<n>`, `VMR_R|Y|B`, `SPD_R|Y|B`, `Temp`, `Hum` (exact IDs preserved). Non-numeric values and unknown keys are ignored for live/charts but remain in the stored raw payload.
- **GN**: allowed as a configured sensor type (Phase 1), but no GN channel key is mapped because none has been confirmed in real payloads. Add the pattern in `src/lib/protocol/sensors.ts` once confirmed.
- **Configured quantity ≠ channel IDs.** Quantity is capacity metadata. Channel IDs a Node really sends are recorded as `discoveredSensors` on first sight; only discovered channels of configured types are offered in Monitoring.
- Timestamps are generated by the server on receipt (the protocol carries no device timestamp).

## 7. Persistence and history

`SensorReading` stores **one original decoded message per document**, unchanged:

```json
{
  "nodeId": 1001,
  "nodeRef": "<Node _id>",
  "data": { "RES_0": 4, "alarm": 0, "start": 1 },
  "receivedAt": "<server date>"
}
```

A single `PersistenceWorker` batches writes every `databaseSaveIntervalSeconds` (default 5; changes apply without restart).

- **`snapshot` (default)**: per Node and per message shape (set of sensor keys, e.g. `{RES_0}` or `{VMR_R,VMR_Y,VMR_B}`), the latest message received in the interval is written. Unchanged values are skipped except for one keep-alive sample per minute.
  **Limitation: messages superseded within an interval are not stored**, so the database does not contain every MQTT update, and live points not yet saved are not recoverable after a browser refresh or service restart.
- **`raw`**: every message (including control messages) is stored, still batched. This is complete message-by-message history at higher storage cost.

Failed writes are retained and retried with the same `_id` (idempotent, so partial successes are not duplicated); pending data is flushed on SIGINT/SIGTERM. Editing or removing a Node's sensor configuration never touches stored readings.

`GET /api/readings/history?nodeId=1001&sensors=RES_0,RES_1&limit=20` returns the **latest `limit` points per sensor** (one indexed query per sensor, so a sparse sensor isn't starved), merged by timestamp, oldest → newest.

## 8. WebSocket protocol (`NEXT_PUBLIC_REALTIME_URL`)

1. Browser calls `GET /api/realtime/token` (session cookie) → `{ token, url }` (JWT, 60 s, single use).
2. Connects to `url?token=…` (Origin checked against `APP_URL`; max message 4 KB; 30 s heartbeat; per-connection rate limit).

| Client → server                                                                                       | Server → client                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `{ "action":"subscribe","requestId":"r1","siteId":"<id>","nodeId":1001,"sensors":["RES_0","RES_1"] }` | `{ "type":"subscribed","requestId":"r1",…,"latest":{…} }`                                                       |
| `{ "action":"unsubscribe","nodeId":1001 }`                                                            | `{ "type":"sensor:update","subscriptionId":"r1","nodeId":1001,"timestamp":"…","values":{"RES_0":4},"alarm":0 }` |
| `{ "action":"ping" }`                                                                                 | `{ "type":"status","mqtt":"connected","liveEnabled":true }`, `{ "type":"error","code":"FORBIDDEN",… }`          |

Each subscribe re-checks the user, Node existence, that the Node belongs to `siteId`, Site access, and that each sensor's type is configured on the Node. A connection holds one subscription; subscribing again replaces it. Events go only to subscribers of that Node, filtered to their sensors and tagged with `subscriptionId` so the browser can drop late events from an older selection. Turning off `liveChart.enabled` stops delivery and rejects new subscriptions.

## 9. Monitoring page

`/monitoring?siteId=<id>&nodeId=1001&sensors=RES_0,RES_1` (URL state survives refresh and is re-validated by the server; inaccessible IDs fall back with a notice).

On load or switch: accessible Sites → Site's Nodes → Node configuration and discovered channels → default to the first channel in stable order (RES, NER, VMR, SPD, TEMP, HUM; channel index or R/Y/B) → history (up to `liveChart.maxPoints` per sensor) → subscribe → append live points. Events arriving while history loads are buffered and replayed, so they're never overwritten. One line per sensor with a stable colour, no fabricated or zero-filled values, and at most `maxPoints` per series. Connection badges show the WebSocket and MQTT state honestly.

Threshold status (normal / below / above / no threshold) is computed from the Node's thresholds; a channel-specific override wins over the type default. The device `alarm` is shown separately as received. Thresholds are configuration values, not certified safety limits.

## 10. REST API

All routes run on the Node.js runtime, validate input with Zod, return `{ error: { message, code } }` on failure, never return password hashes, and require a session except login. State-changing requests must be same-origin (CSRF check).

| Method & path                                                   | Who               | Notes                                                                                 |
| --------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `POST /api/auth/login`                                          | public            | `{ username, password }`; rate limited; generic errors                                |
| `POST /api/auth/logout`, `GET /api/auth/me`                     | signed in         |                                                                                       |
| `POST /api/auth/change-password`                                | signed in         | verifies current password; revokes other sessions                                     |
| `PATCH /api/profile`                                            | signed in         | display name only                                                                     |
| `GET /api/sites` · `POST /api/sites`                            | scoped · admin    | `?q=&status=&page=&limit=`; includes `nodeCount`                                      |
| `GET /api/sites/:id` · `PATCH /api/sites/:id`                   | scoped · admin    | GET includes the Site's Nodes                                                         |
| `GET /api/nodes` · `POST /api/nodes`                            | scoped · admin    | `?q=&siteId=&status=`; 409 `Node ID already exists`, 400 `Please select a valid Site` |
| `GET /api/nodes/:id` · `PATCH /api/nodes/:id`                   | scoped · admin    | `nodeId` immutable; no IP field exists                                                |
| `GET /api/users` · `POST /api/users`                            | admin/technician  | role limited by actor; 409 `Username already exists`                                  |
| `GET/PATCH /api/users/:id`, `PATCH /api/users/:id/assign-sites` | admin/technician  | cannot touch admins or self                                                           |
| `GET /api/settings` · `PATCH /api/settings`                     | signed in · admin | partial updates; validated                                                            |
| `GET /api/readings`                                             | scoped            | stored raw payloads, paginated                                                        |
| `GET /api/readings/history`                                     | scoped            | see §7                                                                                |
| `GET /api/realtime/token`                                       | signed in         | WebSocket token                                                                       |
| `GET /api/monitoring/nav`                                       | scoped            | accessible Sites with their Nodes                                                     |

## 11. Data model (`src/lib/models`)

- **Site**: `siteCode` (unique, upper-case), `siteName`, `location`, `description`, `status` (active/inactive). Sites are deactivated, not deleted.
- **Node**: `nodeId` (unique integer), `nodeName`, `siteId → Site`, `sensors[] { sensorType: RES|NER|VMR|SPD|GN|TEMP|HUM, quantity ≥ 1, thresholds {low, high}, overrides[] {sensorId, low, high} }`, `status` (online/offline), `discoveredSensors[] {sensorId, sensorType, firstSeenAt}`, `lastReadingAt`. **No IP address.**
- **SensorReading**: `nodeId`, `nodeRef → Node`, `data` (original payload), `receivedAt`; indexes `{nodeId, receivedAt:-1}`, `{nodeRef, receivedAt:-1}`.
- **User**: `name`, `username` (unique, lower-case), optional legacy `email`, `passwordHash` (bcrypt, never selected by default), `role`, `assignedSites[] → Site`, `isActive`, `sessionVersion`.
- **GlobalSetting**: single `key: "global"` document with branding, timezone/date format, maintenance mode, `allowUserRegistration` (stored only; no self-registration page exists), `databaseSaveIntervalSeconds`, `liveChart { enabled, maxPoints, reconnectIntervalSeconds }`.

Transactions are not used: every write touches a single document.

## 12. Tests

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run e2e        # against running services (web, realtime, MongoDB, MQTT broker)
```

- `tests/unit`: protocol decoding and parsing, sensor mapping and ordering, thresholds, RBAC matrix, validation, history building, chart state (bounded series, buffering race, stale events), persistence worker (interval, single timer, skip-unchanged, retry, idempotency, raw mode), WebSocket hub (auth, Site/Node/sensor validation, filtering, switching, cleanup, live toggle, rate limit), ingest pipeline (unknown Node, malformed, control, discovery), activity tracker.
- `tests/ui` (jsdom): Site Edit/Save/Cancel with toasts and failure handling, the Add Node modal (validation, payload, error keeps modal open), and the sensor multi-select.
- `scripts/e2e.ts`: real HTTP + WebSocket + MQTT + database (97 checks).

## 13. Troubleshooting

- **"MQTT not configured" badge**: `MQTT_URL` is empty in the realtime service's environment.
- **"MQTT reconnecting/disconnected"**: check broker reachability and credentials; the realtime logs show a redacted broker URL.
- **WebSocket "Disconnected"**: check that the realtime service is running, that `NEXT_PUBLIC_REALTIME_URL` is reachable from the browser, that `APP_URL` matches the page origin (Origin check), and that the proxy forwards upgrades.
- **No channels in Monitoring**: the Node hasn't sent a message for a configured sensor type yet. Check that `Node_Id` matches a registered Node, and look for "Rejected message from unregistered Node" in the logs or `ingest.unknownNode` in `/health`.
- **History empty after refresh**: readings persist every `databaseSaveIntervalSeconds`; check `pendingReadings` in `/health` and the realtime logs for write errors.
- **Users can't sign in after upgrading from an email-based version**: run the username migration (§4).
