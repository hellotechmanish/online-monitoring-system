"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import type { NodeDTO, SiteDTO } from "@/lib/types";
import { can } from "@/lib/auth/rbac";
import { useApp, refreshNav } from "@/components/layout/app-context";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, ErrorState, Forbidden, PageHeader, Skeleton } from "@/components/ui/misc";
import { SiteDetailsCard } from "@/components/sites/site-details-card";
import { NodesTable } from "@/components/nodes/nodes-table";
import { NodeFormModal } from "@/components/nodes/node-form-modal";

export default function SiteDetailPage({ params }: { params: { id: string } }) {
  const { user } = useApp();
  const canEditSite = can(user, "sites:manage");
  const canManageNodes = can(user, "nodes:manage");
  const [site, setSite] = useState<SiteDTO | null>(null);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editNode, setEditNode] = useState<NodeDTO | null>(null);

  const load = useCallback(
    async (opts: { nodesOnly?: boolean } = {}) => {
      if (opts.nodesOnly) setNodesLoading(true);
      else setLoading(true);
      try {
        const r = await api<{ site: SiteDTO; nodes: NodeDTO[] }>(`/api/sites/${params.id}`);
        setSite(r.site);
        // Only Nodes of this Site are returned by the API (filtered by siteId on the server).
        setNodes(r.nodes.filter((n) => n.siteId === r.site.id));
        setError(null);
      } catch (e) {
        setError({ status: e instanceof ApiClientError ? e.status : 0, message: errorMessage(e) });
      } finally {
        setLoading(false);
        setNodesLoading(false);
      }
    },
    [params.id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !site) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error && !site) {
    if (error.status === 403) return <Forbidden message="You do not have access to this Site." />;
    return (
      <Card>
        <ErrorState
          title={error.status === 404 ? "Site not found" : "Could not load Site"}
          message={error.message}
          action={<Link href="/sites" className="text-sm text-primary underline">Back to Sites</Link>}
        />
      </Card>
    );
  }
  if (!site) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <Link href="/sites" className="focus-ring mb-2 inline-flex items-center gap-1 rounded text-xs text-subtle hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Sites
        </Link>
        <PageHeader title={site.siteName} description={<span className="font-mono">{site.siteCode}</span>} />
      </div>

      <SiteDetailsCard
        site={site}
        canEdit={canEditSite}
        onSaved={(s) => {
          setSite(s);
          refreshNav();
        }}
      />

      <Card>
        <CardHeader
          title="Nodes in this Site"
          description={`${nodes.length} Node${nodes.length === 1 ? "" : "s"}`}
          actions={
            canManageNodes && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add Node
              </Button>
            )
          }
        />
        <NodesTable
          nodes={nodes}
          loading={nodesLoading && nodes.length === 0}
          canManage={canManageNodes}
          onEdit={setEditNode}
          label="Nodes in this Site"
          empty={
            <EmptyState
              title="No Nodes in this Site yet"
              description={canManageNodes ? "Add a Node to register its sensor configuration." : undefined}
              action={canManageNodes && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Node</Button>}
            />
          }
        />
      </Card>

      {canManageNodes && (
        <>
          <NodeFormModal
            open={addOpen}
            onOpenChange={setAddOpen}
            mode="create"
            siteId={site.id}
            siteLabel={`${site.siteCode} — ${site.siteName}`}
            onSaved={() => {
              void load({ nodesOnly: true });
              refreshNav();
            }}
          />
          <NodeFormModal
            open={!!editNode}
            onOpenChange={(o) => !o && setEditNode(null)}
            mode="edit"
            node={editNode}
            onSaved={(n) => {
              setNodes((list) => list.map((x) => (x.id === n.id ? n : x)));
              refreshNav();
            }}
          />
        </>
      )}
    </div>
  );
}
