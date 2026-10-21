import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { SessionUser } from "@/lib/auth/rbac";
import type { SubscriptionHub } from "./subscriptions";

export interface WsServerOptions {
  port: number;
  host?: string;
  hub: SubscriptionHub;
  /** Verifies a short-lived WS token and returns the user, session version and token id, or null. */
  authenticate(token: string): Promise<{ user: SessionUser; sv: number; jti?: string } | null>;
  allowedOrigins: string[];
  health?: () => Record<string, unknown>;
  log: { info: (m: string, meta?: Record<string, unknown>) => void; warn: (m: string, meta?: Record<string, unknown>) => void };
  heartbeatMs?: number;
}

const MAX_PAYLOAD = 4 * 1024;
const MAX_BUFFERED = 1024 * 1024;

/**
 * Persistent WebSocket service (plain Node.js HTTP server; not a Next.js route).
 * Authentication: `ws(s)://host/?token=<jwt>` where the token comes from
 * GET /api/realtime/token (valid 60 s, single use). Origin is checked against APP_URL.
 */
export function startWsServer(opts: WsServerOptions) {
  const usedTokens = new Map<string, number>();
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, ...(opts.health?.() ?? {}) }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });

  const reject = (socket: import("node:stream").Duplex, code: number, text: string) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on("upgrade", async (req, socket, head) => {
    try {
      const origin = req.headers.origin;
      if (opts.allowedOrigins.length && origin && !opts.allowedOrigins.includes(origin)) {
        opts.log.warn("WebSocket rejected: origin not allowed", { origin });
        return reject(socket, 403, "Forbidden");
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      const token = url.searchParams.get("token") ?? "";
      if (!token || token.length > 2048) return reject(socket, 401, "Unauthorized");
      const now = Date.now();
      for (const [t, exp] of usedTokens) if (exp < now) usedTokens.delete(t);
      const auth = await opts.authenticate(token);
      if (!auth) return reject(socket, 401, "Unauthorized");
      const key = auth.jti ?? token; // single use per token id
      if (usedTokens.has(key)) return reject(socket, 401, "Unauthorized");
      usedTokens.set(key, now + 120_000);
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, auth));
    } catch {
      reject(socket, 500, "Internal Server Error");
    }
  });

  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (ws: WebSocket, auth: { user: SessionUser; sv: number }) => {
    const id = randomUUID();
    alive.set(ws, true);
    opts.hub.addClient({
      id,
      userId: auth.user.id,
      sv: auth.sv,
      user: auth.user,
      send: (msg) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > MAX_BUFFERED) return; // slow consumer: drop rather than grow memory
        ws.send(JSON.stringify(msg));
      },
      close: (code, reason) => ws.close(code, reason),
    });
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      void opts.hub.handleMessage(id, data.toString());
    });
    ws.on("close", () => opts.hub.removeClient(id));
    ws.on("error", () => opts.hub.removeClient(id));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, opts.heartbeatMs ?? 30_000);
  heartbeat.unref();

  server.listen(opts.port, opts.host ?? "0.0.0.0", () => opts.log.info("WebSocket server listening", { port: opts.port }));

  return {
    server,
    wss,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.close(1001, "server shutdown");
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
