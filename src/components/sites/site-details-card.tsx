"use client";

import { useEffect, useState } from "react";
import { Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/client-api";
import { siteUpdateSchema } from "@/lib/validation";
import type { SiteDTO } from "@/lib/types";

type Editable = Pick<SiteDTO, "siteCode" | "siteName" | "location" | "description" | "status">;
const pick = (s: SiteDTO): Editable => ({ siteCode: s.siteCode, siteName: s.siteName, location: s.location, description: s.description, status: s.status });

/**
 * Site details with Edit → Save/Cancel flow.
 * Read-only by default; Save validates, PATCHes, and only on success updates the
 * displayed values, toasts and returns to read-only. On failure the unsaved form
 * values are kept. Cancel restores the last saved values.
 */
export function SiteDetailsCard({ site, canEdit, onSaved }: { site: SiteDTO; canEdit: boolean; onSaved: (s: SiteDTO) => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Editable>(pick(site));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!editing) setForm(pick(site));
  }, [site, editing]);

  const set = (k: keyof Editable) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function cancel() {
    setForm(pick(site));
    setErrors({});
    setEditing(false);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    const parsed = siteUpdateSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      toast.error("Please fix the highlighted fields");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const r = await api<{ site: SiteDTO }>(`/api/sites/${site.id}`, { method: "PATCH", body: parsed.data });
      onSaved(r.site);
      setEditing(false);
      toast.success("Site updated successfully");
    } catch (err) {
      const msg = errorMessage(err, "Unable to save changes");
      if (msg.toLowerCase().includes("site code")) setErrors({ siteCode: msg });
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const ro = !editing;
  return (
    <Card>
      <CardHeader
        title="Site details"
        description={editing ? "Editing — changes are saved only when you click Save." : undefined}
        actions={
          canEdit &&
          (editing ? (
            <>
              <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button size="sm" type="submit" form="site-details-form" loading={saving}>
                {!saving && <Save className="h-3.5 w-3.5" />} Save
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          ))
        }
      />
      <form id="site-details-form" onSubmit={save} noValidate className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Site Code" htmlFor="sd-code" required={editing} error={errors.siteCode}>
          <Input id="sd-code" value={form.siteCode} onChange={set("siteCode")} readOnly={ro} aria-invalid={!!errors.siteCode || undefined} className="font-mono" />
        </Field>
        <Field label="Site Name" htmlFor="sd-name" required={editing} error={errors.siteName}>
          <Input id="sd-name" value={form.siteName} onChange={set("siteName")} readOnly={ro} aria-invalid={!!errors.siteName || undefined} />
        </Field>
        <Field label="Status" htmlFor="sd-status">
          {ro ? (
            <div className="flex h-9 items-center">
              {form.status === "active" ? <Badge tone="success" dot>Active</Badge> : <Badge dot>Inactive</Badge>}
            </div>
          ) : (
            <Select id="sd-status" value={form.status} onChange={set("status")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          )}
        </Field>
        <Field label="Location" htmlFor="sd-loc" error={errors.location}>
          <Input id="sd-loc" value={form.location} onChange={set("location")} readOnly={ro} placeholder={ro ? "—" : ""} />
        </Field>
        <Field label="Record ID" htmlFor="sd-id" hint="Immutable">
          <Input id="sd-id" value={site.id} readOnly className="font-mono text-xs" />
        </Field>
        <div className="hidden lg:block" />
        <Field label="Description" htmlFor="sd-desc" className="sm:col-span-2 lg:col-span-3" error={errors.description}>
          <Textarea id="sd-desc" value={form.description} onChange={set("description")} readOnly={ro} placeholder={ro ? "—" : ""} />
        </Field>
      </form>
    </Card>
  );
}
