"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Info, RefreshCw, Radio, Wifi, WifiOff } from "lucide-react";
import { api, errorMessage } from "@/lib/client-api";
import type { HistoryResponse, MonitoringNavSite, NodeDTO } from "@/lib/types";
import { colorForSensor, sensorTypeOf, sortSensorIds } from "@/lib/protocol/sensors";
import {
  applyEvent, applyHistory, applyLatestSnapshot, createSeriesState, pointCount, toChartRows, type LiveEvent, type SeriesState,
} from "@/lib/live-series";
import { useApp, useFormat } from "@/components/layout/app-context";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { MultiSelect } from "@/components/ui/multi-select";
import { cn } from "@/lib/cn";
import { NodeStatusBadge, SensorBadges } from "@/components/nodes/nodes-table";
import { useRealtime, type ServerMessage } from "./use-realtime";
import { LiveChart } from "./live-chart";
import { LatestValues } from "./latest-values";

type HistoryStatus = "idle" | "loading" | "loaded" | "error";

export function MonitoringView() {
  const { settings } = useApp();
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlSite = sp.get("siteId");
  const urlNode = sp.get("nodeId");
  const urlSensorsRaw = sp.get("sensors"); // null = not specified (auto-select); "" = explicitly none
  const maxPoints = settings.liveChart.maxPoints;
  const liveAllowed = settings.liveChart.enabled;

  const [sites, setSites] = useState<MonitoringNavSite[] | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [node, setNode] = useState<NodeDTO | null>(null);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [nodeReload, setNodeReload] = useState(0);
  const [series, setSeries] = useState<SeriesState>(() => createSeriesState(null, [], maxPoints));
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const setQuery = useCallback(
    (q: { siteId?: string | null; nodeId?: string | number | null; sensors?: string[] | null }) => {
      const p = new URLSearchParams();
      if (q.siteId) p.set("siteId", q.siteId);
      if (q.nodeId !== undefined && q.nodeId !== null) p.set("nodeId", String(q.nodeId));
      if (q.sensors) p.set("sensors", q.sensors.join(","));
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  // ---- 1. Accessible Sites + Nodes (server-filtered by role/assignment) ----
  const loadNav = useCallback(async () => {
    try {
      const r = await api<{ items: MonitoringNavSite[] }>("/api/monitoring/nav");
      setSites(r.items);
      setNavError(null);
    } catch (e) {
      setNavError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void loadNav();
    const h = () => void loadNav();
    window.addEventListener("derms:nav-refresh", h);
    return () => window.removeEventListener("derms:nav-refresh", h);
  }, [loadNav]);

  const site = useMemo(() => sites?.find((s) => s.id === urlSite) ?? null, [sites, urlSite]);
  const navNode = useMemo(() => site?.nodes.find((n) => String(n.nodeId) === urlNode) ?? null, [site, urlNode]);

  // ---- 2. Validate/repair Site and Node from the URL ----
  useEffect(() => {
    if (!sites || sites.length === 0) return;
    if (!site) {
      if (urlSite) setNotice("The requested Site is not available to your account. Showing an accessible Site instead.");
      setQuery({ siteId: sites[0].id });
    }
  }, [sites, site, urlSite, setQuery]);

  useEffect(() => {
    if (!site || site.nodes.length === 0) return;
    if (!navNode) {
      if (urlNode) setNotice(`Node ${urlNode} is not part of ${site.siteName}. Showing the first Node of this Site.`);
      setQuery({ siteId: site.id, nodeId: site.nodes[0].nodeId, sensors: urlSensorsRaw !== null ? urlSensorsRaw.split(",").filter(Boolean) : null });
    }
  }, [site, navNode, urlNode, urlSensorsRaw, setQuery]);

  // ---- 3. Selected Node details (configuration + discovered channels) ----
  useEffect(() => {
    setNode(null);
    setNodeError(null);
    if (!navNode) return;
    const ac = new AbortController();
    api<{ node: NodeDTO }>(`/api/nodes/${navNode.id}`, { signal: ac.signal })
      .then((r) => setNode(r.node))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setNodeError(errorMessage(e));
      });
    return () => ac.abort();
  }, [navNode, nodeReload]);

  const nodeReady = !!node && !!navNode && node.nodeId === navNode.nodeId;
  const available = useMemo(() => {
    if (!nodeReady || !node) return [];
    const configured = new Set(node.sensors.map((s) => s.sensorType));
    return sortSensorIds(node.discoveredSensors.filter((s) => {
      const t = sensorTypeOf(s);
      return !!t && configured.has(t);
    }));
  }, [node, nodeReady]);

  const requested = useMemo(() => (urlSensorsRaw ? urlSensorsRaw.split(",").map((s) => s.trim()).filter(Boolean) : []), [urlSensorsRaw]);
  const selected = useMemo(() => sortSensorIds(requested.filter((s) => available.includes(s))), [requested, available]);

  // ---- 4. Default sensor: first available channel (stable order) unless user explicitly chose none ----
  useEffect(() => {
    if (!nodeReady || !site || !navNode || available.length === 0) return;
    const explicitNone = urlSensorsRaw === "";
    if (explicitNone) return;
    if (selected.length === 0) setQuery({ siteId: site.id, nodeId: navNode.nodeId, sensors: [available[0]] });
    else if (selected.length !== requested.length) setQuery({ siteId: site.id, nodeId: navNode.nodeId, sensors: selected });
  }, [nodeReady, site, navNode, available, selected, requested, urlSensorsRaw, setQuery]);

  // ---- 5. Live connection ----
  const rt = useRealtime({ enabled: liveAllowed, reconnectSeconds: settings.liveChart.reconnectIntervalSeconds });
  const reconnectGen = Math.max(0, rt.connectionId - 1); // >0 only after a reconnect

  const selectionKey = nodeReady && site && node && selected.length > 0 ? `${site.id}|${node.nodeId}|${selected.join(",")}` : "";
  const epochRef = useRef(0);
  const reqIdRef = useRef<string | null>(null);

  // History load (and reset) whenever the selection changes, or after a reconnect (to fill gaps).
  useEffect(() => {
    const epoch = ++epochRef.current;
    setLiveError(null);
    setSubscribed(false);
    if (!selectionKey || !node) {
      setSeries(createSeriesState(null, [], maxPoints));
      setHistoryStatus("idle");
      return;
    }
    setSeries(createSeriesState(node.nodeId, selected, maxPoints));
    setHistoryStatus("loading");
    setHistoryError(null);
    const ac = new AbortController();
    const qs = new URLSearchParams({ nodeId: String(node.nodeId), sensors: selected.join(","), limit: String(maxPoints) });
    api<HistoryResponse>(`/api/readings/history?${qs}`, { signal: ac.signal })
      .then((r) => {
        if (epoch !== epochRef.current) return; // stale response for an old selection
        setSeries((s) => applyHistory(s, r.points));
        setHistoryStatus("loaded");
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError" || epoch !== epochRef.current) return;
        setSeries((s) => applyHistory(s, []));
        setHistoryStatus("error");
        setHistoryError(errorMessage(e, "Could not load history"));
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, maxPoints, reconnectGen]);

  // WebSocket subscription for the active selection; the previous one is unsubscribed first.
  useEffect(() => {
    if (!selectionKey || !site || !node || rt.state !== "connected" || !rt.liveEnabled) return;
    const requestId = `${epochRef.current}-${rt.connectionId}-${Math.random().toString(36).slice(2, 8)}`;
    reqIdRef.current = requestId;
    rt.send({ action: "subscribe", requestId, siteId: site.id, nodeId: node.nodeId, sensors: selected });
    return () => {
      reqIdRef.current = null;
      setSubscribed(false);
      rt.send({ action: "unsubscribe", nodeId: node.nodeId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, rt.state, rt.connectionId, rt.liveEnabled]);

  // Incoming messages: batch live events per animation frame to keep the UI responsive.
  const queueRef = useRef<LiveEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const { onMessage } = rt;
  useEffect(() => {
    onMessage((msg: ServerMessage) => {
      if (msg.type === "sensor:update") {
        if (msg.subscriptionId !== reqIdRef.current) return; // late event from an old subscription
        queueRef.current.push({ nodeId: msg.nodeId, timestamp: msg.timestamp, values: msg.values, alarm: msg.alarm ?? null });
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const batch = queueRef.current;
            queueRef.current = [];
            setSeries((s) => batch.reduce(applyEvent, s));
          });
        }
      } else if (msg.type === "subscribed") {
        if (msg.requestId !== reqIdRef.current) return;
        setSubscribed(true);
        setLiveError(null);
        setSeries((s) => applyLatestSnapshot(s, msg.latest));
      } else if (msg.type === "error") {
        if (!msg.requestId || msg.requestId === reqIdRef.current) setLiveError(msg.message);
      } else if (msg.type === "unsubscribed" && msg.reason === "LIVE_DISABLED") {
        setSubscribed(false);
      }
    });
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      queueRef.current = [];
    };
  }, [onMessage]);

  const rows = useMemo(() => toChartRows(series), [series]);
  const fmtTime = useCallback((t: number) => f.time(t), [f]);
  const fmtDateTime = useCallback((t: number) => f.dateTime(t), [f]);

  // ---------------------------------- render ----------------------------------
  if (navError && !sites) {
    return <Card><ErrorState title="Could not load Sites" message={navError} action={<Button variant="outline" onClick={() => void loadNav()}>Retry</Button>} /></Card>;
  }
  if (!sites) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (sites.length === 0) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title="Monitoring" />
        <Card><EmptyState title="No Sites available" description="No Sites exist yet, or none are assigned to your account." /></Card>
      </div>
    );
  }

  const live = liveAllowed && rt.liveEnabled;
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader title="Monitoring" description="One Site and one Node at a time. History comes from MongoDB; new points arrive over WebSocket." actions={<ConnectionBadges liveAllowed={liveAllowed} rt={rt} subscribed={subscribed} />} />

      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <span className="flex items-center gap-2"><Info className="h-4 w-4 shrink-0" /> {notice}</span>
          <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <Card className="p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.3fr)]">
          <div>
            <label htmlFor="mon-site" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-subtle">Site</label>
            <Select id="mon-site" value={site?.id ?? ""} onChange={(e) => { setNotice(null); setQuery({ siteId: e.target.value }); }}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.siteCode} — {s.siteName}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="mon-sensors" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-subtle">Sensors</label>
            <MultiSelect
              id="mon-sensors"
              label="Sensors"
              placeholder={!nodeReady ? "Loading channels…" : available.length === 0 ? "No channels discovered" : "Select sensors"}
              disabled={!nodeReady || available.length === 0}
              options={available.map((s) => ({ value: s, color: colorForSensor(s) }))}
              value={selected}
              onChange={(v) => site && navNode && setQuery({ siteId: site.id, nodeId: navNode.nodeId, sensors: sortSensorIds(v) })}
            />
          </div>
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">Node</p>
          {site && site.nodes.length === 0 ? (
            <p className="text-sm text-subtle">This Site has no Nodes yet.</p>
          ) : (
            <div role="tablist" aria-label="Nodes" className="flex flex-wrap gap-2">
              {site?.nodes.map((n) => {
                const active = navNode?.id === n.id;
                return (
                  <button
                    key={n.id}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    onClick={() => { setNotice(null); site && setQuery({ siteId: site.id, nodeId: n.nodeId, sensors: urlSensorsRaw ? requested : null }); }}
                    className={cn(
                      "focus-ring inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                      active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border bg-surface hover:bg-muted",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", n.status === "online" ? "bg-success" : "bg-border")} aria-label={n.status} />
                    <span className="font-mono">{n.nodeId}</span>
                    <span className="text-subtle">{n.nodeName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {site && site.nodes.length === 0 ? (
        <Card><EmptyState title="No Nodes in this Site" description="Add a Node from the Site page to start monitoring." action={<Link href={`/sites/${site.id}`} className="text-sm text-primary underline">Open Site</Link>} /></Card>
      ) : nodeError ? (
        <Card><ErrorState title="Could not load Node" message={nodeError} action={<Button variant="outline" onClick={() => setNodeReload((n) => n + 1)}>Retry</Button>} /></Card>
      ) : !nodeReady || !node ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm">
              <span className="font-semibold">Node <span className="font-mono">{node.nodeId}</span> · {node.nodeName}</span>
              <span className="flex items-center gap-2 text-subtle">Status <NodeStatusBadge status={node.status} /></span>
              <span className="text-subtle">Last reading: <span className="text-foreground">{f.dateTime(node.lastReadingAt)}</span></span>
              <span className="flex items-center gap-2 text-subtle">Configured <SensorBadges node={node} /></span>
              <Link href={`/nodes/${node.id}`} className="ml-auto text-xs text-primary hover:underline">Node details</Link>
            </div>
          </Card>

          {available.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Radio className="h-6 w-6" />}
                title="No sensor channels discovered yet"
                description="Channel IDs (e.g. RES_0, VMR_R) appear after this Node sends its first MQTT message for a configured sensor type. Configured quantities alone do not create channels."
                action={<Button variant="outline" size="sm" onClick={() => setNodeReload((n) => n + 1)}><RefreshCw className="h-3.5 w-3.5" /> Check again</Button>}
              />
            </Card>
          ) : selected.length === 0 ? (
            <Card><EmptyState title="No sensors selected" description="Choose one or more sensors from the Sensors dropdown to plot them." /></Card>
          ) : (
            <>
              <LatestValues sensors={selected} latest={series.latest} config={node.sensors} formatDateTime={(v) => f.dateTime(v)} />
              <Card>
                <CardHeader
                  title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Node {node.nodeId} — {selected.join(", ")}</span>}
                  description={
                    historyStatus === "loading" ? "Loading persisted history…" :
                    `Up to ${maxPoints} points per sensor. Restored points are the last persisted readings; updates between database saves are not recoverable after a refresh.`
                  }
                  actions={live && subscribed ? <Badge tone="success" dot>Live</Badge> : live ? <Badge tone="warning" dot>Not live</Badge> : <Badge dot>History only</Badge>}
                />
                {liveError && <p role="alert" className="mx-5 mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">Live subscription: {liveError}</p>}
                {historyError && <p role="alert" className="mx-5 mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{historyError}</p>}
                <div className="p-3 sm:p-5">
                  {historyStatus === "loading" && pointCount(series) === 0 ? (
                    <Skeleton className="h-[340px] w-full sm:h-[400px]" />
                  ) : pointCount(series) === 0 ? (
                    <EmptyState
                      title="No readings to display yet"
                      description={live ? (subscribed ? "Waiting for the next reading from this Node…" : "No persisted history. Live updates will appear once the connection is established.") : "No persisted history for the selected sensors."}
                    />
                  ) : (
                    <LiveChart rows={rows} sensors={selected} formatTime={fmtTime} formatDateTime={fmtDateTime} />
                  )}
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ConnectionBadges({ liveAllowed, rt, subscribed }: { liveAllowed: boolean; rt: ReturnType<typeof useRealtime>; subscribed: boolean }) {
  if (!liveAllowed) return <Badge>Live monitoring disabled in Global Settings</Badge>;
  const ws =
    rt.state === "connected" ? <Badge tone="success" dot><Wifi className="h-3 w-3" /> WebSocket connected</Badge> :
    rt.state === "reconnecting" ? <Badge tone="warning" dot>Reconnecting…</Badge> :
    rt.state === "disconnected" ? <Badge tone="danger" dot><WifiOff className="h-3 w-3" /> Disconnected</Badge> :
    <Badge tone="info" dot>Connecting…</Badge>;
  const mqtt =
    rt.state !== "connected" ? null :
    rt.mqtt === "connected" ? <Badge tone="success" dot>MQTT connected</Badge> :
    rt.mqtt === "disabled" ? <Badge dot>MQTT not configured</Badge> :
    rt.mqtt === "unknown" ? null :
    <Badge tone="warning" dot>MQTT {rt.mqtt}</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      {ws}
      {mqtt}
      {rt.state === "connected" && !rt.liveEnabled && <Badge>Live delivery disabled</Badge>}
      {rt.state === "disconnected" && <Button size="sm" variant="outline" onClick={rt.retry}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>}
      <span className="sr-only">{subscribed ? "Subscribed to live updates" : "Not subscribed"}</span>
    </div>
  );
}
