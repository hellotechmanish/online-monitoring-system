import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettingsSafe } from "@/lib/safe-settings";
import { AppShell } from "@/components/layout/app-shell";
import { AppProvider } from "@/components/layout/app-context";
import { Card, EmptyState, ErrorState } from "@/components/ui/misc";
import { Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { settings, dbError } = await getSettingsSafe();
  if (dbError) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <Card>
          <ErrorState title="Database unavailable" message="The application cannot reach MongoDB right now. Please try again shortly." />
        </Card>
      </main>
    );
  }
  const user = await getCurrentUser();
  if (!user) redirect("/login?expired=1");

  const maintenanceBlocked = settings.maintenanceMode && user.role !== "admin";
  return (
    <AppProvider value={{ user, settings }}>
      <AppShell>
        {maintenanceBlocked ? (
          <Card>
            <EmptyState
              icon={<Wrench className="h-6 w-6" aria-hidden />}
              title="Under maintenance"
              description="The system is temporarily under maintenance. Please check back later."
            />
          </Card>
        ) : (
          children
        )}
      </AppShell>
    </AppProvider>
  );
}
