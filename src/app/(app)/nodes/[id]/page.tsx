"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowLeft, Pencil } from "lucide-react";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import type { NodeDTO, Paginated, SiteDTO } from "@/lib/types";
import { can } from "@/lib/auth/rbac";
import { sensorTypeOf } from "@/lib/protocol/sensors";
import { useApp, useFormat, refreshNav } from "@/components/layout/app-context";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Forbidden, PageHeader, Skeleton } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { NodeStatusBadge } from "@/components/nodes/nodes-table";
import { NodeFormModal } from "@/components/nodes/node-form-modal";

interface ReadingRow { id: string; nodeId: number; data: Record<string, unknown>; receivedAt: string }

export default function NodeDetailPage({ params }: { params: { id: string } }) {
  const { user } = useApp();
  const f = useFormat();
  const canManage = can(user, "nodes:manage");
  const [node, setNode] = useState<NodeDTO | null>(null);
  const [readings, setReadings] = useState<ReadingRow[] | null>(null);
  const [sites, setSites] = useState<SiteDTO[]>([]);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ node: NodeDTO }>(`/api/nodes/${params.id}`);
      setNode(r.node);
      setError(null);
      const rd = await api<Paginated<ReadingRow>>(`/api/readings?nodeId=${r.node.nodeId}&limit=20`);
      setReadings(rd.items);
    } catch (e) {
      setError({ status: e instanceof ApiClientError ? e.status : 0, message: errorMessage(e) });
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (canManage) api<Paginated<SiteDTO>>("/api/sites?all=1&limit=500").then((r) => setSites(r.items)).catch(() => {});
  }, [canManage]);

  if (error && !node) {
    if (error.status === 403) return <Forbidden message="You do not have access to this Node." />;
    return <Card><ErrorState title={error.status === 404 ? "Node not found" : "Could not load Node"} message={error.message} /></Card>;
  }
  if (!node) return <div className="mx-auto max-w-7xl space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;

  const configuredTypes = new Set(node.sensors.map((s) => s.sensorType));
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <Link href="/nodes" className="focus-ring mb-2 inline-flex items-center gap-1 rounded text-xs text-subtle hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Nodes
        </Link>
        <PageHeader
          title={<span>Node <span className="font-mono">{node.nodeId}</span> · {node.nodeName}</span>}
          description={node.site ? <>Site: <Link className="text-primary hover:underline" href={`/sites/${node.site.id}`}>{node.site.siteCode} — {node.site.siteName}</Link></> : undefined}
          actions={
            <>
              <Link href={`/monitoring?siteId=${node.siteId}&nodeId=${node.nodeId}`} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-muted">
                <Activity className="h-4 w-4" /> Monitor
              </Link>
              {canManage && <Button onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>}
            </>
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Sensor configuration" description="Quantities are configured capacity; thresholds are optional configuration values." />
          {node.sensors.length === 0 ? (
            <EmptyState title="No sensors configured" />
          ) : (
            <Table label="Sensor configuration">
              <THead><tr><TH>Type</TH><TH className="text-right">Quantity</TH><TH className="text-right">Low</TH><TH className="text-right">High</TH><TH>Channel overrides</TH></tr></THead>
              <TBody>
                {node.sensors.map((s) => (
                  <TR key={s.sensorType}>
                    <TD className="font-mono font-semibold">{s.sensorType}</TD>
                    <TD className="tabular text-right">{s.quantity}</TD>
                    <TD className="tabular text-right">{s.thresholds.low ?? <span className="text-subtle">—</span>}</TD>
                    <TD className="tabular text-right">{s.thresholds.high ?? <span className="text-subtle">—</span>}</TD>
                    <TD className="text-xs">
                      {s.overrides.length === 0 ? <span className="text-subtle">—</span> : s.overrides.map((o) => (
                        <div key={o.sensorId} className="font-mono">{o.sensorId}: {o.low ?? "—"} … {o.high ?? "—"}</div>
                      ))}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Status" />
          <dl className="space-y-3 p-5 text-sm">
            <div className="flex justify-between"><dt className="text-subtle">Connection</dt><dd><NodeStatusBadge status={node.status} /></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-subtle">Last reading</dt><dd className="text-right">{f.dateTime(node.lastReadingAt)}</dd></div>
            <div>
              <dt className="mb-1.5 text-subtle">Discovered channels</dt>
              <dd className="flex flex-wrap gap-1">
                {node.discoveredSensors.length === 0 ? <span className="text-xs text-subtle">None yet — channels appear after the first device message.</span> :
                  node.discoveredSensors.map((s) => {
                    const t = sensorTypeOf(s);
                    const ok = t && configuredTypes.has(t);
                    return <Badge key={s} tone={ok ? "info" : "warning"} className="font-mono" >{s}{!ok && " (not configured)"}</Badge>;
                  })}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent stored readings" description="Original decoded payloads persisted by the realtime service (newest first)." />
        {readings === null ? <div className="p-5"><Skeleton className="h-24 w-full" /></div> : readings.length === 0 ? (
          <EmptyState title="No stored readings yet" />
        ) : (
          <Table label="Recent readings">
            <THead><tr><TH>Received</TH><TH>Payload</TH></tr></THead>
            <TBody>
              {readings.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-xs">{f.dateTime(r.receivedAt)}</TD>
                  <TD className="font-mono text-xs">{JSON.stringify(r.data)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {canManage && (
        <NodeFormModal open={editOpen} onOpenChange={setEditOpen} mode="edit" node={node} sites={sites} onSaved={(n) => { setNode(n); refreshNav(); }} />
      )}
    </div>
  );
}
