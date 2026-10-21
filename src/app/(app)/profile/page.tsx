"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/client-api";
import { changePasswordSchema, profileUpdateSchema } from "@/lib/validation";
import { useApp } from "@/components/layout/app-context";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/misc";

const ROLE_LABEL = { admin: "Admin", technician: "Technician", user: "User" } as const;

export default function ProfilePage() {
  const { user } = useApp();
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [savingPw, setSavingPw] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const parsed = profileUpdateSchema.safeParse({ name });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setSavingName(true);
    try {
      await api("/api/profile", { method: "PATCH", body: parsed.data });
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Unable to save changes"));
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const parsed = changePasswordSchema.safeParse({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
    if (!parsed.success) for (const i of parsed.error.issues) errs[i.path.join(".")] = i.message;
    if (pw.newPassword !== pw.confirm) errs.confirm = "Passwords do not match";
    setPwErrors(errs);
    if (Object.keys(errs).length || !parsed.success) return;
    setSavingPw(true);
    try {
      await api("/api/auth/change-password", { method: "POST", body: parsed.data });
      toast.success("Password changed. Other sessions were signed out.");
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err) {
      const msg = errorMessage(err, "Unable to change password");
      if (msg.toLowerCase().includes("current")) setPwErrors({ currentPassword: msg });
      toast.error(msg);
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="My Profile" />
      <Card>
        <CardHeader title="Account" />
        <form onSubmit={saveName} className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Full name" htmlFor="p-name"><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Username" htmlFor="p-username" hint="Usernames are managed by administrators."><Input id="p-username" value={user.username} readOnly className="font-mono" /></Field>
          <div className="flex items-center gap-2 text-sm"><span className="text-subtle">Role:</span><Badge tone="info">{ROLE_LABEL[user.role]}</Badge></div>
          <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={savingName} disabled={name.trim() === user.name}>Save</Button></div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Change password" />
        <form onSubmit={changePassword} noValidate className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Current password" htmlFor="p-cur" error={pwErrors.currentPassword}><Input id="p-cur" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password" htmlFor="p-new" error={pwErrors.newPassword}><Input id="p-new" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <Field label="Confirm new password" htmlFor="p-conf" error={pwErrors.confirm}><Input id="p-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <div className="flex justify-end sm:col-span-3"><Button type="submit" loading={savingPw}>Change password</Button></div>
        </form>
      </Card>
    </div>
  );
}
