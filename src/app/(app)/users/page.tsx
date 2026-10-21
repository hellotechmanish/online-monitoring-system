"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Pencil, Plus, Power, Search } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/client-api";
import type { Paginated, SiteDTO, UserDTO } from "@/lib/types";
import { can, canManageAccount, creatableRoles } from "@/lib/auth/rbac";
import { useApp } from "@/components/layout/app-context";
import { useDebounced } from "@/components/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Card, EmptyState, ErrorState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Pagination, Table, TBody, TD, TH, THead, TR, TableSkeleton } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { AssignSitesModal, UserCreateModal, UserEditModal } from "@/components/users/user-modals";

const ROLE_TONE = { admin: "navy", technician: "info", user: "neutral" } as const;
const ROLE_LABEL = { admin: "Admin", technician: "Technician", user: "User" } as const;

export default function UsersPage() {
  const { user: me } = useApp();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<UserDTO> | null>(null);
  const [sites, setSites] = useState<SiteDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserDTO | null>(null);
  const [assignUser, setAssignUser] = useState<UserDTO | null>(null);
  const [toggleUser, setToggleUser] = useState<UserDTO | null>(null);
  const [toggling, setToggling] = useState(false);
  const dq = useDebounced(q);
  const allowed = can(me, "users:view");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ page: String(page), limit: "20" });
      if (dq) sp.set("q", dq);
      if (role) sp.set("role", role);
      setData(await api<Paginated<UserDTO>>(`/api/users?${sp}`, { signal }));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(errorMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, dq, role]);

  useEffect(() => {
    if (!allowed) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load, allowed]);
  useEffect(() => setPage(1), [dq, role]);
  useEffect(() => {
    if (allowed) api<Paginated<SiteDTO>>("/api/sites?all=1&limit=500").then((r) => setSites(r.items)).catch(() => {});
  }, [allowed]);

  if (!allowed) return <Forbidden />;
  const roles = creatableRoles(me);
  const siteCode = (id: string) => sites.find((s) => s.id === id)?.siteCode ?? "…";

  async function confirmToggle() {
    if (!toggleUser) return;
    setToggling(true);
    try {
      await api(`/api/users/${toggleUser.id}`, { method: "PATCH", body: { isActive: !toggleUser.isActive } });
      toast.success(toggleUser.isActive ? "User deactivated" : "User activated");
      setToggleUser(null);
      void load();
    } catch (e) {
      toast.error(errorMessage(e, "Unable to save changes"));
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Users" description={me.role === "admin" ? "Manage Technician and User accounts." : "Manage User accounts and their Site assignments."}
        actions={roles.length > 0 && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create user</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input aria-label="Search users" placeholder="Search by name or username" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} className="w-40">
            <option value="">All roles</option>
            {me.role === "admin" && <option value="admin">Admin</option>}
            <option value="technician">Technician</option>
            <option value="user">User</option>
          </Select>
        </div>
        {error ? <ErrorState message={error} action={<Button variant="outline" onClick={() => void load()}>Retry</Button>} /> : (
          <>
            <Table label="Users">
              <THead><tr><TH>Name</TH><TH>Username</TH><TH>Role</TH><TH>Status</TH><TH>Assigned Sites</TH><TH className="text-right">Actions</TH></tr></THead>
              {loading && !data ? <TableSkeleton cols={6} /> : data && data.items.length === 0 ? (
                <TBody><tr><td colSpan={6}><EmptyState title={dq || role ? "No users match your filters" : "No users yet"} /></td></tr></TBody>
              ) : (
                <TBody>
                  {data?.items.map((u) => {
                    const manageable = canManageAccount(me, u.role, u.id);
                    return (
                      <TR key={u.id} className={loading ? "opacity-60" : undefined}>
                        <TD className="font-medium">{u.name}{u.id === me.id && <span className="ml-1 text-xs text-subtle">(you)</span>}</TD>
                        <TD className="font-mono text-xs">{u.username}</TD>
                        <TD><Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge></TD>
                        <TD>{u.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge tone="danger" dot>Inactive</Badge>}</TD>
                        <TD className="text-xs">
                          {u.role !== "user" ? <span className="text-subtle">All Sites</span> : u.assignedSites.length === 0 ? <span className="text-subtle">None</span> :
                            <div className="flex flex-wrap gap-1">{u.assignedSites.map((s) => <Badge key={s} className="font-mono">{siteCode(s)}</Badge>)}</div>}
                        </TD>
                        <TD className="text-right">
                          {manageable ? (
                            <div className="inline-flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setEditUser(u)} aria-label={`Edit ${u.username}`}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                              {can(me, "users:assign_sites") && (
                                <Button variant="ghost" size="sm" onClick={() => setAssignUser(u)} aria-label={`Assign Sites to ${u.username}`}><Building2 className="h-3.5 w-3.5" /> Sites</Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => setToggleUser(u)} className={u.isActive ? "text-danger hover:bg-danger/10" : "text-success hover:bg-success/10"} aria-label={`${u.isActive ? "Deactivate" : "Activate"} ${u.username}`}>
                                <Power className="h-3.5 w-3.5" /> {u.isActive ? "Deactivate" : "Activate"}
                              </Button>
                            </div>
                          ) : <span className="text-xs text-subtle">—</span>}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              )}
            </Table>
            {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <UserCreateModal open={createOpen} onOpenChange={setCreateOpen} roles={roles} sites={sites} onSaved={() => void load()} />
      <UserEditModal user={editUser} onOpenChange={(o) => !o && setEditUser(null)} roles={roles} onSaved={() => void load()} />
      <AssignSitesModal user={assignUser} onOpenChange={(o) => !o && setAssignUser(null)} sites={sites} onSaved={() => void load()} />
      <ConfirmDialog
        open={!!toggleUser}
        onOpenChange={(o) => !o && setToggleUser(null)}
        title={toggleUser?.isActive ? "Deactivate user?" : "Activate user?"}
        message={toggleUser?.isActive ? <>This signs <strong>{toggleUser?.username}</strong> out immediately and blocks sign-in until reactivated.</> : <>Allow <strong>{toggleUser?.username}</strong> to sign in again?</>}
        confirmLabel={toggleUser?.isActive ? "Deactivate" : "Activate"}
        tone={toggleUser?.isActive ? "danger" : "primary"}
        loading={toggling}
        onConfirm={confirmToggle}
      />
    </div>
  );
}
