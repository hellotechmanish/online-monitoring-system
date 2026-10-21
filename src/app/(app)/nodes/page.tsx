"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, errorMessage } from "@/lib/client-api";
import type { NodeDTO, Paginated, SiteDTO } from "@/lib/types";
import { can } from "@/lib/auth/rbac";
import { useApp, refreshNav } from "@/components/layout/app-context";
import { useDebounced } from "@/components/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, EmptyState, ErrorState, PageHeader } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/table";
import { NodesTable } from "@/components/nodes/nodes-table";
import { NodeFormModal } from "@/components/nodes/node-form-modal";

export default function NodesPage() {
  const { user } = useApp();
  const canManage = can(user, "nodes:manage");
  const [q, setQ] = useState("");
  const [siteId, setSiteId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [sites, setSites] = useState<SiteDTO[]>([]);
  const [data, setData] = useState<Paginated<NodeDTO> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editNode, setEditNode] = useState<NodeDTO | null>(null);
  const dq = useDebounced(q);

  useEffect(() => {
    api<Paginated<SiteDTO>>("/api/sites?all=1&limit=500").then((r) => setSites(r.items)).catch(() => setSites([]));
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({ page: String(page), limit: "20" });
        if (dq) sp.set("q", dq);
        if (siteId) sp.set("siteId", siteId);
        if (status) sp.set("status", status);
        setData(await api<Paginated<NodeDTO>>(`/api/nodes?${sp}`, { signal }));
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(errorMessage(e));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, dq, siteId, status],
  );
  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);
  useEffect(() => setPage(1), [dq, siteId, status]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Nodes"
        description="Converters/Nodes and their configured sensors."
        actions={canManage && <Button onClick={() => setCreateOpen(true)} disabled={sites.length === 0} title={sites.length === 0 ? "Create a Site first" : undefined}><Plus className="h-4 w-4" /> Add Node</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input aria-label="Search nodes" placeholder="Search by Node ID or name" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Filter by Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-56">
            <option value="">All Sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.siteCode} — {s.siteName}</option>
            ))}
          </Select>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
            <option value="">All statuses</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </Select>
        </div>
        {error ? (
          <ErrorState message={error} action={<Button variant="outline" onClick={() => void load()}>Retry</Button>} />
        ) : (
          <>
            <NodesTable
              nodes={data?.items ?? []}
              loading={loading && !data}
              showSite
              canManage={canManage}
              onEdit={setEditNode}
              empty={<EmptyState title={dq || siteId || status ? "No Nodes match your filters" : "No Nodes yet"} />}
            />
            {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      {canManage && (
        <>
          <NodeFormModal
            open={createOpen}
            onOpenChange={setCreateOpen}
            mode="create"
            siteId={siteId || undefined}
            sites={sites}
            onSaved={() => {
              void load();
              refreshNav();
            }}
          />
          <NodeFormModal
            open={!!editNode}
            onOpenChange={(o) => !o && setEditNode(null)}
            mode="edit"
            node={editNode}
            sites={sites}
            onSaved={() => {
              void load();
              refreshNav();
            }}
          />
        </>
      )}
    </div>
  );
}
