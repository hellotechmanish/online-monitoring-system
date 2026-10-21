"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { MultiSelect } from "@/components/ui/multi-select";
import { api, errorMessage } from "@/lib/client-api";
import { userCreateSchema, userUpdateSchema, type Role } from "@/lib/validation";
import type { SiteDTO, UserDTO } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", technician: "Technician", user: "User" };

function issuesToMap(issues: { path: (string | number)[]; message: string }[]) {
  return Object.fromEntries(issues.map((i) => [i.path.join("."), i.message]));
}

function SitePicker({ sites, value, onChange, id }: { sites: SiteDTO[]; value: string[]; onChange: (v: string[]) => void; id: string }) {
  return (
    <MultiSelect
      id={id}
      label="Assigned Sites"
      placeholder="No Sites assigned"
      options={sites.map((s) => ({ value: s.id, label: `${s.siteCode} — ${s.siteName}` }))}
      value={value}
      onChange={onChange}
      emptyText="No Sites exist yet"
    />
  );
}

export function UserCreateModal({
  open, onOpenChange, roles, sites, onSaved,
}: { open: boolean; onOpenChange: (o: boolean) => void; roles: Role[]; sites: SiteDTO[]; onSaved: () => void }) {
  const empty = { name: "", username: "", password: "", role: roles.includes("user") ? "user" : roles[0], assignedSites: [] as string[], isActive: true };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) { setV(empty); setErrors({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = userCreateSchema.safeParse(v);
    if (!parsed.success) return setErrors(issuesToMap(parsed.error.issues));
    setErrors({});
    setSaving(true);
    try {
      await api("/api/users", { method: "POST", body: parsed.data });
      toast.success("User created successfully");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const msg = errorMessage(err, "Unable to create user");
      if (msg.toLowerCase().includes("username")) setErrors({ username: msg });
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Create user" preventClose={saving}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button type="submit" form="user-create" loading={saving}>Create user</Button></>}>
      <form id="user-create" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="u-name" required error={errors.name}>
          <Input id="u-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-invalid={!!errors.name || undefined} />
        </Field>
        <Field label="Username" htmlFor="u-username" required error={errors.username} hint="3–32 chars: a–z, 0–9, . _ -">
          <Input id="u-username" autoCapitalize="none" spellCheck={false} value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} aria-invalid={!!errors.username || undefined} />
        </Field>
        <Field label="Password" htmlFor="u-password" required error={errors.password} hint="At least 8 characters">
          <Input id="u-password" type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} aria-invalid={!!errors.password || undefined} />
        </Field>
        <Field label="Role" htmlFor="u-role" required error={errors.role}>
          <Select id="u-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Field label="Assigned Sites" htmlFor="u-sites" className="sm:col-span-2" hint={v.role === "technician" ? "Technicians can view all Sites; assignments are optional." : "Users can only see their assigned Sites."}>
          <SitePicker id="u-sites" sites={sites} value={v.assignedSites} onChange={(s) => setV({ ...v, assignedSites: s })} />
        </Field>
        <Checkbox label="Account active" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
      </form>
    </Modal>
  );
}

export function UserEditModal({
  user, onOpenChange, roles, onSaved,
}: { user: UserDTO | null; onOpenChange: (o: boolean) => void; roles: Role[]; onSaved: () => void }) {
  const [v, setV] = useState({ name: "", username: "", role: "user" as Role, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (user) { setV({ name: user.name, username: user.username, role: user.role, password: "" }); setErrors({}); }
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const body: Record<string, unknown> = {};
    if (v.name !== user.name) body.name = v.name;
    if (v.username !== user.username) body.username = v.username;
    if (v.role !== user.role) body.role = v.role;
    if (v.password) body.password = v.password;
    const parsed = userUpdateSchema.safeParse(body);
    if (!parsed.success) return setErrors(issuesToMap(parsed.error.issues));
    if (Object.keys(parsed.data).length === 0) return onOpenChange(false);
    setSaving(true);
    try {
      await api(`/api/users/${user.id}`, { method: "PATCH", body: parsed.data });
      toast.success("User updated successfully");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const msg = errorMessage(err, "Unable to save changes");
      if (msg.toLowerCase().includes("username")) setErrors({ username: msg });
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!user} onOpenChange={onOpenChange} title={`Edit ${user?.username ?? "user"}`} preventClose={saving}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button type="submit" form="user-edit" loading={saving}>Save</Button></>}>
      <form id="user-edit" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="e-name" error={errors.name}>
          <Input id="e-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Username" htmlFor="e-username" error={errors.username}>
          <Input id="e-username" autoCapitalize="none" spellCheck={false} value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} />
        </Field>
        <Field label="Role" htmlFor="e-role">
          <Select id="e-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })} disabled={roles.length < 2}>
            {Array.from(new Set([...roles, v.role])).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Field label="Reset password" htmlFor="e-password" error={errors.password} hint="Leave empty to keep the current password. Resetting signs the user out.">
          <Input id="e-password" type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

export function AssignSitesModal({
  user, onOpenChange, sites, onSaved,
}: { user: UserDTO | null; onOpenChange: (o: boolean) => void; sites: SiteDTO[]; onSaved: () => void }) {
  const [value, setValue] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (user) setValue(user.assignedSites); }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      await api(`/api/users/${user.id}/assign-sites`, { method: "PATCH", body: { assignedSites: value } });
      toast.success("User assigned successfully");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Unable to save changes"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!user} onOpenChange={onOpenChange} title={`Assign Sites to ${user?.username ?? ""}`} size="sm" preventClose={saving}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <Field label="Assigned Sites" htmlFor="a-sites" hint="The user will only see these Sites, their Nodes and readings.">
        <SitePicker id="a-sites" sites={sites} value={value} onChange={setValue} />
      </Field>
    </Modal>
  );
}
