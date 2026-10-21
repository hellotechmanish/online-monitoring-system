"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity, Building2, ChevronDown, ChevronRight, Cpu, LayoutDashboard, LogOut, Menu, Settings, UserCircle, Users, X,
} from "lucide-react";
import { useApp } from "./app-context";
import { BrandMark } from "./brand";
import { can } from "@/lib/auth/rbac";
import { cn } from "@/lib/cn";
import { api } from "@/lib/client-api";
import type { MonitoringNavSite } from "@/lib/types";
import { Badge } from "@/components/ui/misc";
import { toast } from "sonner";

const ROLE_LABEL = { admin: "Admin", technician: "Technician", user: "User" } as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, settings } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-navy text-white shadow">
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-5">
          <button
            type="button"
            className="focus-ring rounded-md p-2 hover:bg-white/10 lg:hidden"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <BrandMark logoUrl={settings.logoUrl} size={38} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold tracking-wide sm:text-lg">{settings.projectTitle}</p>
            <p className="truncate text-[10px] font-medium tracking-[0.18em] text-white/70 sm:text-xs">{settings.projectSubtitle}</p>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{user.name}</p>
              <p className="text-xs text-white/60">@{user.username}</p>
            </div>
            <Badge tone="info" className="bg-white/10 text-white ring-white/25">
              {ROLE_LABEL[user.role]}
            </Badge>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {mobileOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-20 w-72 transform border-r border-border bg-surface pt-[60px] transition-transform lg:sticky lg:top-[60px] lg:h-[calc(100vh-60px)] lg:translate-x-0 lg:pt-0",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Main navigation"
        >
          <Suspense fallback={null}>
            <SidebarNav />
          </Suspense>
        </aside>
        <main className="min-w-0 flex-1 px-3 py-5 sm:px-6">
          {children}
          {(settings.footerText || settings.organizationName) && (
            <footer className="mt-10 border-t border-border pt-4 text-center text-xs text-subtle">
              {settings.footerText || settings.organizationName}
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}

function NavLink({ href, icon, label, active }: { href: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
      )}
    >
      <span className="h-4 w-4 shrink-0">{icon}</span>
      {label}
    </Link>
  );
}

function SidebarNav() {
  const { user } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Unable to sign out. Please try again.");
      setLoggingOut(false);
    }
  }

  const is = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <MonitoringTree active={is("/monitoring")} />
      <NavLink href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" active={is("/dashboard")} />
      <NavLink href="/sites" icon={<Building2 className="h-4 w-4" />} label="Sites" active={is("/sites")} />
      <NavLink href="/nodes" icon={<Cpu className="h-4 w-4" />} label="Nodes" active={is("/nodes")} />
      {can(user, "users:view") && <NavLink href="/users" icon={<Users className="h-4 w-4" />} label="Users" active={is("/users")} />}
      {can(user, "settings:manage") && (
        <NavLink href="/settings" icon={<Settings className="h-4 w-4" />} label="Global Settings" active={is("/settings")} />
      )}
      <NavLink href="/profile" icon={<UserCircle className="h-4 w-4" />} label="My Profile" active={is("/profile")} />
      <div className="mt-auto border-t border-border pt-2">
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="focus-ring flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" /> {loggingOut ? "Signing out…" : "Logout"}
        </button>
      </div>
    </nav>
  );
}

function MonitoringTree({ active }: { active: boolean }) {
  const sp = useSearchParams();
  const currentSite = active ? sp.get("siteId") : null;
  const currentNode = active ? sp.get("nodeId") : null;
  const [open, setOpen] = useState(true);
  const [sites, setSites] = useState<MonitoringNavSite[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: MonitoringNavSite[] }>("/api/monitoring/nav");
      setSites(r.items);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const h = () => void load();
    window.addEventListener("derms:nav-refresh", h);
    return () => window.removeEventListener("derms:nav-refresh", h);
  }, [load]);

  useEffect(() => {
    if (currentSite) setExpanded((e) => ({ ...e, [currentSite]: true }));
  }, [currentSite]);

  return (
    <div>
      <div className={cn("flex items-center rounded-md", active && !currentSite ? "bg-primary/10 text-primary" : "hover:bg-muted")}>
        <Link href="/monitoring" className="focus-ring flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium" aria-current={active && !currentSite ? "page" : undefined}>
          <Activity className="h-4 w-4" /> Monitoring
        </Link>
        <button
          type="button"
          className="focus-ring mr-1 rounded p-1.5 text-subtle hover:bg-border/60"
          aria-label={open ? "Collapse monitoring sites" : "Expand monitoring sites"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
      {open && (
        <ul className="ml-4 mt-1 space-y-0.5 border-l border-border pl-2" aria-label="Monitoring sites">
          {sites === null && !error && <li className="px-2 py-1 text-xs text-subtle">Loading sites…</li>}
          {error && (
            <li className="px-2 py-1 text-xs text-danger">
              Could not load sites.{" "}
              <button type="button" className="underline" onClick={() => void load()}>
                Retry
              </button>
            </li>
          )}
          {sites?.length === 0 && <li className="px-2 py-1 text-xs text-subtle">No accessible sites</li>}
          {sites?.map((s) => {
            const isExp = expanded[s.id];
            const siteActive = currentSite === s.id;
            return (
              <li key={s.id}>
                <div className={cn("flex items-center rounded", siteActive && !currentNode ? "bg-primary/10 text-primary" : "hover:bg-muted")}>
                  <button
                    type="button"
                    className="focus-ring rounded p-1 text-subtle"
                    aria-label={`${isExp ? "Collapse" : "Expand"} ${s.siteName}`}
                    aria-expanded={!!isExp}
                    onClick={() => setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))}
                  >
                    {isExp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <Link
                    href={`/monitoring?siteId=${s.id}`}
                    className={cn("focus-ring flex-1 truncate rounded px-1 py-1 text-[13px]", siteActive && "font-semibold")}
                    title={`${s.siteCode} — ${s.siteName}`}
                  >
                    {s.siteName}
                    {s.status === "inactive" && <span className="ml-1 text-[10px] text-subtle">(inactive)</span>}
                  </Link>
                </div>
                {isExp && (
                  <ul className="ml-5 space-y-0.5 py-0.5">
                    {s.nodes.length === 0 && <li className="px-2 py-0.5 text-xs text-subtle">No nodes</li>}
                    {s.nodes.map((n) => {
                      const nodeActive = siteActive && currentNode === String(n.nodeId);
                      return (
                        <li key={n.id}>
                          <Link
                            href={`/monitoring?siteId=${s.id}&nodeId=${n.nodeId}`}
                            aria-current={nodeActive ? "page" : undefined}
                            className={cn(
                              "focus-ring flex items-center gap-2 rounded px-2 py-1 text-xs",
                              nodeActive ? "bg-primary/10 font-semibold text-primary" : "text-subtle hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 rounded-full", n.status === "online" ? "bg-success" : "bg-border")} aria-hidden />
                            Node {n.nodeId}
                            <span className="truncate text-subtle">· {n.nodeName}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
