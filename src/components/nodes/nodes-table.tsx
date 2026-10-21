"use client";

import Link from "next/link";
import { Activity, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import type { NodeDTO } from "@/lib/types";
import { Table, TBody, TD, TH, THead, TR, TableSkeleton } from "@/components/ui/table";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/components/layout/app-context";

export function SensorBadges({ node }: { node: Pick<NodeDTO, "sensors"> }) {
  if (node.sensors.length === 0) return <span className="text-xs text-subtle">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {node.sensors.map((s) => (
        <Badge key={s.sensorType} tone="neutral" className="font-mono">
          {s.sensorType}×{s.quantity}
        </Badge>
      ))}
    </div>
  );
}

export function NodeStatusBadge({ status }: { status: NodeDTO["status"] }) {
  return status === "online" ? (
    <Badge tone="success" dot>Online</Badge>
  ) : (
    <Badge tone="neutral" dot>Offline</Badge>
  );
}

export function NodesTable({
  nodes,
  loading,
  showSite,
  canManage,
  onEdit,
  empty,
  label = "Nodes",
}: {
  nodes: NodeDTO[];
  loading?: boolean;
  showSite?: boolean;
  canManage?: boolean;
  onEdit?: (n: NodeDTO) => void;
  empty?: ReactNode;
  label?: string;
}) {
  const f = useFormat();
  const cols = showSite ? 8 : 7;
  return (
    <Table label={label}>
      <THead>
        <tr>
          <TH>Node ID</TH>
          <TH>Node Name</TH>
          {showSite && <TH>Site</TH>}
          <TH>Configured Sensors</TH>
          <TH className="text-right">Sensor Quantity</TH>
          <TH>Status</TH>
          <TH>Last Reading</TH>
          <TH className="text-right">Actions</TH>
        </tr>
      </THead>
      {loading ? (
        <TableSkeleton cols={cols} rows={4} />
      ) : nodes.length === 0 ? (
        <TBody>
          <tr>
            <td colSpan={cols}>{empty ?? <EmptyState title="No Nodes" />}</td>
          </tr>
        </TBody>
      ) : (
        <TBody>
          {nodes.map((n) => (
            <TR key={n.id}>
              <TD className="font-mono font-semibold">
                <Link href={`/nodes/${n.id}`} className="focus-ring rounded text-primary hover:underline">
                  {n.nodeId}
                </Link>
              </TD>
              <TD>{n.nodeName}</TD>
              {showSite && (
                <TD>
                  {n.site ? (
                    <Link href={`/sites/${n.site.id}`} className="focus-ring rounded hover:underline">
                      <span className="font-mono text-xs text-subtle">{n.site.siteCode}</span> {n.site.siteName}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TD>
              )}
              <TD>
                <SensorBadges node={n} />
              </TD>
              <TD className="tabular text-right">{n.sensors.reduce((a, s) => a + s.quantity, 0)}</TD>
              <TD>
                <NodeStatusBadge status={n.status} />
              </TD>
              <TD className="whitespace-nowrap text-xs text-subtle">{n.lastReadingAt ? f.dateTime(n.lastReadingAt) : "—"}</TD>
              <TD className="text-right">
                <div className="inline-flex gap-1">
                  <Link
                    href={`/monitoring?siteId=${n.siteId}&nodeId=${n.nodeId}`}
                    className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-primary hover:bg-primary/10"
                    aria-label={`Monitor Node ${n.nodeId}`}
                  >
                    <Activity className="h-3.5 w-3.5" /> Monitor
                  </Link>
                  {canManage && onEdit && (
                    <Button variant="ghost" size="sm" onClick={() => onEdit(n)} aria-label={`Edit Node ${n.nodeId}`}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      )}
    </Table>
  );
}
