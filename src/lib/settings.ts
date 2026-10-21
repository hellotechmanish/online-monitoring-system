import { connectDB } from "./db";
import { GlobalSetting, SETTINGS_DEFAULTS } from "./models";

export type AppSettings = typeof SETTINGS_DEFAULTS;

export function normalizeSettings(doc: Partial<AppSettings> | null | undefined): AppSettings {
  const d = doc ?? {};
  return {
    ...SETTINGS_DEFAULTS,
    ...Object.fromEntries(Object.entries(d).filter(([k]) => k in SETTINGS_DEFAULTS)),
    liveChart: { ...SETTINGS_DEFAULTS.liveChart, ...(d.liveChart ?? {}) },
  } as AppSettings;
}

export async function getSettings(): Promise<AppSettings> {
  await connectDB();
  const doc = await GlobalSetting.findOne({ key: "global" }).lean();
  return normalizeSettings(doc as Partial<AppSettings> | null);
}

/** Subset safe to show before login (branding only). */
export function publicSettings(s: AppSettings) {
  return {
    projectTitle: s.projectTitle,
    projectSubtitle: s.projectSubtitle,
    organizationName: s.organizationName,
    logoUrl: s.logoUrl,
    faviconUrl: s.faviconUrl,
    footerText: s.footerText,
    theme: s.theme,
    timezone: s.timezone,
    dateFormat: s.dateFormat,
    maintenanceMode: s.maintenanceMode,
  };
}
