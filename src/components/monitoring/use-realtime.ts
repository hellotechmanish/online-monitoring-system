"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ConnState = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";
export type MqttState = "disabled" | "connecting" | "connected" | "reconnecting" | "disconnected" | "unknown";

export type ServerMessage =
  | { type: "hello"; status: { mqtt: MqttState; liveEnabled: boolean } }
  | { type: "status"; mqtt: MqttState; liveEnabled: boolean }
  | { type: "subscribed"; requestId: string; nodeId: number; siteId: string; sensors: string[]; latest: Record<string, { value: number; timestamp: string; alarm: number | null }> }
  | { type: "unsubscribed"; nodeId: number | null; reason?: string }
  | { type: "sensor:update"; subscriptionId: string; nodeId: number; timestamp: string; values: Record<string, number>; alarm?: number }
  | { type: "error"; code: string; message: string; requestId?: string }
  | { type: "pong" };

const MAX_ATTEMPTS = 12;
const MAX_DELAY_MS = 30_000;

/**
 * One authenticated WebSocket connection to the realtime service.
 * - Gets a short-lived token from /api/realtime/token (session cookie auth), then connects.
 * - Reconnects with bounded exponential backoff starting at `reconnectSeconds`.
 * - `connectionId` increments on every successful (re)connect so callers can re-subscribe.
 */
export function useRealtime({ enabled, reconnectSeconds }: { enabled: boolean; reconnectSeconds: number }) {
  const [state, setState] = useState<ConnState>("idle");
  const [mqtt, setMqtt] = useState<MqttState>("unknown");
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [connectionId, setConnectionId] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef<(m: ServerMessage) => void>(() => {});

  const onMessage = useCallback((h: (m: ServerMessage) => void) => {
    handlerRef.current = h;
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState("idle");
      return;
    }
    let disposed = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const schedule = () => {
      if (disposed) return;
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        setState("disconnected");
        return;
      }
      setState("reconnecting");
      const delay = Math.min(MAX_DELAY_MS, Math.max(1, reconnectSeconds) * 1000 * 2 ** Math.min(attempts - 1, 5));
      timer = setTimeout(connect, delay);
    };

    async function connect() {
      if (disposed) return;
      setState((s) => (s === "reconnecting" ? "reconnecting" : "connecting"));
      let token: string;
      let url: string;
      try {
        const res = await fetch("/api/realtime/token", { cache: "no-store", credentials: "same-origin" });
        if (res.status === 401) {
          window.location.href = "/login?expired=1";
          return;
        }
        if (!res.ok) throw new Error("token");
        ({ token, url } = (await res.json()) as { token: string; url: string });
      } catch {
        schedule();
        return;
      }
      if (disposed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`);
      } catch {
        schedule();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        if (disposed) return ws.close();
        attempts = 0;
        setState("connected");
        setConnectionId((c) => c + 1);
        ping = setInterval(() => send({ action: "ping" }), 25_000);
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "hello") {
          setMqtt(msg.status.mqtt);
          setLiveEnabled(msg.status.liveEnabled);
        } else if (msg.type === "status") {
          setMqtt(msg.mqtt);
          setLiveEnabled(msg.liveEnabled);
        }
        handlerRef.current(msg);
      };
      ws.onclose = () => {
        if (ping) clearInterval(ping);
        ping = null;
        if (wsRef.current === ws) wsRef.current = null;
        setMqtt("unknown");
        if (!disposed) schedule();
      };
      ws.onerror = () => {
        /* onclose follows */
      };
    }

    void connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close(1000, "unmount");
    };
  }, [enabled, reconnectSeconds, retryNonce, send]);

  return { state, mqtt, liveEnabled, connectionId, send, onMessage, retry };
}
