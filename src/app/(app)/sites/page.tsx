"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, errorMessage } from "@/lib/client-api";
import type { Paginated, SiteDTO } from "@/lib/types";
import { can } from "@/lib/auth/rbac";
import { useApp, refreshNav } from "@/components/layout/app-context";
import { useDebounced } from "@/components/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Card, EmptyState, ErrorState, PageHeader } from "@/components/ui/misc";
import { Pagination, Table, TBody, TD, TH, THead, TR, TableSkeleton } from "@/components/ui/table";
import { SiteCreateModal } from "@/components/sites/site-create-modal";

export default function SitesPage() {
  const { user } = useApp();
  const canManage = can(user, "sites:manage");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<SiteDTO> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const dq = useDebounced(q);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({ page: String(page), limit: "20" });
        if (dq) sp.set("q", dq);
        if (status) sp.set("status", status);
        setData(await api<Paginated<SiteDTO>>(`/api/sites?${sp}`, { signal }));
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(errorMessage(e));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, dq, status],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);
  useEffect(() => setPage(1), [dq, status]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Sites"
        description={user.role === "user" ? "Sites assigned to you." : "Buildings and monitoring locations."}
        actions={canManage && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Add Site</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input aria-label="Search sites" placeholder="Search by code, name or location" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        {error ? (
          <ErrorState message={error} action={<Button variant="outline" onClick={() => void load()}>Retry</Button>} />
        ) : (
          <>
            <Table label="Sites">
              <THead>
                <tr>
                  <TH>Site Code</TH>
                  <TH>Site Name</TH>
                  <TH>Location</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Nodes</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              {loading && !data ? (
                <TableSkeleton cols={6} />
              ) : data && data.items.length === 0 ? (
                <TBody>
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        title={dq || status ? "No Sites match your filters" : "No Sites yet"}
                        description={user.role === "user" && !dq ? "No Sites have been assigned to your account." : undefined}
                        action={canManage && !dq && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Add Site</Button>}
                      />
                    </td>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {data?.items.map((s) => (
                    <TR key={s.id} className={loading ? "opacity-60" : undefined}>
                      <TD className="font-mono font-semibold">{s.siteCode}</TD>
                      <TD>
                        <Link href={`/sites/${s.id}`} className="focus-ring rounded font-medium text-primary hover:underline">{s.siteName}</Link>
                      </TD>
                      <TD className="text-subtle">{s.location || "—"}</TD>
                      <TD>{s.status === "active" ? <Badge tone="success" dot>Active</Badge> : <Badge dot>Inactive</Badge>}</TD>
                      <TD className="tabular text-right">{s.nodeCount ?? 0}</TD>
                      <TD className="text-right">
                        <Link href={`/sites/${s.id}`} className="focus-ring inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-primary hover:bg-primary/10">
                          View{canManage ? " / Edit" : ""}
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              )}
            </Table>
            {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <SiteCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void load();
          refreshNav();
        }}
      />
    </div>
  );
}
