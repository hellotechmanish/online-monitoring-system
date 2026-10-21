"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/client-api";
import { siteCreateSchema } from "@/lib/validation";
import type { SiteDTO } from "@/lib/types";

const EMPTY = { siteCode: "", siteName: "", location: "", description: "", status: "active" };

export function SiteCreateModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (s: SiteDTO) => void }) {
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setV(EMPTY);
      setErrors({});
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = siteCreateSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const r = await api<{ site: SiteDTO }>("/api/sites", { method: "POST", body: parsed.data });
      toast.success("Site created successfully");
      onCreated(r.site);
      onOpenChange(false);
    } catch (err) {
      const msg = errorMessage(err, "Unable to create Site");
      if (msg.toLowerCase().includes("site code")) setErrors({ siteCode: msg });
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add Site"
      preventClose={saving}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="site-create" loading={saving}>Create Site</Button>
        </>
      }
    >
      <form id="site-create" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Site Code" htmlFor="c-code" required error={errors.siteCode}>
          <Input id="c-code" value={v.siteCode} onChange={set("siteCode")} placeholder="SITE-001" aria-invalid={!!errors.siteCode || undefined} />
        </Field>
        <Field label="Site Name" htmlFor="c-name" required error={errors.siteName}>
          <Input id="c-name" value={v.siteName} onChange={set("siteName")} placeholder="Building A" aria-invalid={!!errors.siteName || undefined} />
        </Field>
        <Field label="Location" htmlFor="c-loc" error={errors.location}>
          <Input id="c-loc" value={v.location} onChange={set("location")} />
        </Field>
        <Field label="Status" htmlFor="c-status">
          <Select id="c-status" value={v.status} onChange={set("status")}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        <Field label="Description" htmlFor="c-desc" className="sm:col-span-2" error={errors.description}>
          <Textarea id="c-desc" value={v.description} onChange={set("description")} />
        </Field>
      </form>
    </Modal>
  );
}
