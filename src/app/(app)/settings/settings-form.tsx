"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AppSettings } from "@/lib/settings";
import { api, errorMessage } from "@/lib/client-api";
import { settingsUpdateSchema, DATE_FORMATS } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/misc";

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);

  const set = <K extends keyof AppSettings>(k: K, val: AppSettings[K]) => setV((s) => ({ ...s, [k]: val }));
  const setLive = (k: keyof AppSettings["liveChart"], val: number | boolean) => setV((s) => ({ ...s, liveChart: { ...s.liveChart, [k]: val } }));
  const txt = (k: keyof AppSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value as never);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = settingsUpdateSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      toast.error("Please fix the highlighted fields");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const r = await api<{ settings: AppSettings }>("/api/settings", { method: "PATCH", body: parsed.data });
      setSaved(r.settings);
      setV(r.settings);
      toast.success("Settings saved");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Unable to save changes"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Card>
        <CardHeader title="Branding" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Project title" htmlFor="s-title" required error={errors.projectTitle}><Input id="s-title" value={v.projectTitle} onChange={txt("projectTitle")} /></Field>
          <Field label="Project subtitle" htmlFor="s-sub" error={errors.projectSubtitle}><Input id="s-sub" value={v.projectSubtitle} onChange={txt("projectSubtitle")} /></Field>
          <Field label="Organization name" htmlFor="s-org" error={errors.organizationName}><Input id="s-org" value={v.organizationName} onChange={txt("organizationName")} /></Field>
          <Field label="Footer text" htmlFor="s-footer" error={errors.footerText}><Input id="s-footer" value={v.footerText} onChange={txt("footerText")} /></Field>
          <Field label="Logo URL" htmlFor="s-logo" error={errors.logoUrl} hint="Use only an authorized logo. Empty shows a neutral placeholder."><Input id="s-logo" value={v.logoUrl} onChange={txt("logoUrl")} placeholder="https://… or /logo.png" /></Field>
          <Field label="Favicon URL" htmlFor="s-fav" error={errors.faviconUrl}><Input id="s-fav" value={v.faviconUrl} onChange={txt("faviconUrl")} /></Field>
          <Field label="Theme" htmlFor="s-theme">
            <Select id="s-theme" value={v.theme} onChange={txt("theme")}>
              <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
            </Select>
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Regional" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Timezone" htmlFor="s-tz" error={errors.timezone} hint="IANA name, e.g. Asia/Kolkata"><Input id="s-tz" value={v.timezone} onChange={txt("timezone")} /></Field>
          <Field label="Date format" htmlFor="s-df">
            <Select id="s-df" value={v.dateFormat} onChange={txt("dateFormat")}>{DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}</Select>
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Operations" description="Protected settings — administrators only." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Database save interval (seconds)" htmlFor="s-int" error={errors.databaseSaveIntervalSeconds}
            hint="How often the realtime service persists the latest readings to MongoDB. It does not throttle the live chart.">
            <Input id="s-int" type="number" min={1} step={1} value={v.databaseSaveIntervalSeconds} onChange={(e) => set("databaseSaveIntervalSeconds", Number(e.target.value))} />
          </Field>
          <Field label="Max live chart points" htmlFor="s-max" error={errors["liveChart.maxPoints"]} hint="Points kept per sensor series (default 20).">
            <Input id="s-max" type="number" min={5} step={1} value={v.liveChart.maxPoints} onChange={(e) => setLive("maxPoints", Number(e.target.value))} />
          </Field>
          <Field label="WebSocket reconnect interval (seconds)" htmlFor="s-rc" error={errors["liveChart.reconnectIntervalSeconds"]} hint="Initial delay; the browser backs off up to 30 s.">
            <Input id="s-rc" type="number" min={1} step={1} value={v.liveChart.reconnectIntervalSeconds} onChange={(e) => setLive("reconnectIntervalSeconds", Number(e.target.value))} />
          </Field>
          <div className="space-y-3 pt-6">
            <Checkbox label="Live chart enabled" checked={v.liveChart.enabled} onChange={(e) => setLive("enabled", e.target.checked)} />
            <Checkbox label="Maintenance mode (only admins can sign in)" checked={v.maintenanceMode} onChange={(e) => set("maintenanceMode", e.target.checked)} />
            <Checkbox label="Allow user self-registration (reserved — no registration page exists)" checked={v.allowUserRegistration} onChange={(e) => set("allowUserRegistration", e.target.checked)} />
          </div>
        </div>
      </Card>
      <div className="sticky bottom-3 flex justify-end gap-2 rounded-lg border border-border bg-surface/95 p-3 shadow-sm backdrop-blur">
        <Button variant="outline" onClick={() => { setV(saved); setErrors({}); }} disabled={!dirty || saving}>Discard changes</Button>
        <Button type="submit" loading={saving} disabled={!dirty}>Save settings</Button>
      </div>
    </form>
  );
}
