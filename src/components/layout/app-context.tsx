"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/rbac";
import type { AppSettings } from "@/lib/settings";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";

interface Ctx {
  user: SessionUser;
  settings: AppSettings;
}
const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}

export function useFormat() {
  const { settings } = useApp();
  const tz = settings.timezone;
  const fmt = settings.dateFormat;
  return {
    dateTime: useCallback((v: string | number | Date | null | undefined) => formatDateTime(v, tz, fmt), [tz, fmt]),
    date: useCallback((v: string | number | Date | null | undefined) => formatDate(v, tz, fmt), [tz, fmt]),
    time: useCallback((v: string | number | Date) => formatTime(v, tz), [tz]),
    timezone: tz,
  };
}

/** Asks the sidebar Monitoring tree to reload (after Site/Node changes). */
export function refreshNav() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("derms:nav-refresh"));
}
