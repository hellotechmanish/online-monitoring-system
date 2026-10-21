import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getSettings } from "@/lib/settings";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Global Settings" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?expired=1");
  if (!can(user, "settings:manage")) return <Forbidden message="Only administrators can manage Global Settings." />;
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Global Settings" description="Branding, regional and operational settings. Changes apply without restarting the services." />
      <SettingsForm initial={settings} />
    </div>
  );
}
