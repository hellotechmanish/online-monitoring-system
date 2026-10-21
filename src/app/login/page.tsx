import { getSettingsSafe } from "@/lib/safe-settings";
import { BrandMark } from "@/components/layout/brand";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: { next?: string; expired?: string } }) {
  const { settings, dbError } = await getSettingsSafe();
  const next = searchParams.next && searchParams.next.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : "/monitoring";
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <BrandMark logoUrl={settings.logoUrl} />
          <div>
            <p className="text-lg font-bold tracking-wide">{settings.projectTitle}</p>
            <p className="text-xs font-medium tracking-[0.18em] text-white/70">{settings.projectSubtitle}</p>
          </div>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-subtle">Use your username and password.</p>
          {searchParams.expired && (
            <p className="mt-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">Your session has ended. Please sign in again.</p>
          )}
          {dbError && (
            <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              The database is currently unreachable. Sign-in may fail until it is available.
            </p>
          )}
          {settings.maintenanceMode && (
            <p className="mt-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">Maintenance mode is on: only administrators can sign in.</p>
          )}
          <LoginForm next={next} />
        </div>
      </div>
      {settings.footerText && <footer className="py-4 text-center text-xs text-subtle">{settings.footerText}</footer>}
    </main>
  );
}
