import { getSettings, normalizeSettings, type AppSettings } from "./settings";
import { logger, errInfo } from "./logger";

/** Settings for rendering; falls back to defaults if the DB is unreachable so pages still render an error state. */
export async function getSettingsSafe(): Promise<{ settings: AppSettings; dbError: boolean }> {
  try {
    return { settings: await getSettings(), dbError: false };
  } catch (e) {
    logger("settings").error("Could not load settings", errInfo(e));
    return { settings: normalizeSettings(null), dbError: true };
  }
}
