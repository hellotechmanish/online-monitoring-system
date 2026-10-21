import { ok, parseBody, requirePermission, requireUser, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { GlobalSetting } from "@/lib/models";
import { getSettings, normalizeSettings, type AppSettings } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Settings contain no secrets; every authenticated user needs chart/branding values. */
export const GET = route(async () => {
  await requireUser();
  return ok({ settings: await getSettings() });
});

export const PATCH = route(async (req) => {
  const user = await requireUser();
  requirePermission(user, "settings:manage", "Only administrators can change Global Settings");
  const body = await parseBody(req, settingsUpdateSchema);
  const { liveChart, ...rest } = body;
  const $set: Record<string, unknown> = { ...rest };
  // Dotted paths merge partial liveChart updates without wiping other sub-fields.
  for (const [k, v] of Object.entries(liveChart ?? {})) $set[`liveChart.${k}`] = v;
  await connectDB();
  const doc = await GlobalSetting.findOneAndUpdate(
    { key: "global" },
    { $set },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  return ok({ settings: normalizeSettings(doc as Partial<AppSettings>) });
});
