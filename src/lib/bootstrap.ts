import bcrypt from "bcryptjs";
import { GlobalSetting, Node, SensorReading, Site, User, SETTINGS_DEFAULTS } from "./models";
import { logger, errInfo } from "./logger";
import { USERNAME_RE } from "./validation";

const log = logger("bootstrap");

/**
 * Idempotent first-run bootstrap:
 *  1. Ensure indexes exist (unique siteCode / nodeId / username, reading indexes).
 *  2. Create the GlobalSetting document only if missing ($setOnInsert never overwrites).
 *  3. Create the initial Admin from env only if NO admin exists. Never touches an existing admin.
 */
export async function runBootstrap(): Promise<void> {
  await Promise.all([Site.init(), Node.init(), SensorReading.init(), User.init(), GlobalSetting.init()]);

  await GlobalSetting.updateOne(
    { key: "global" },
    { $setOnInsert: { key: "global", ...SETTINGS_DEFAULTS } },
    { upsert: true },
  );

  const legacy = await User.countDocuments({ $or: [{ username: { $exists: false } }, { username: null }, { username: "" }] });
  if (legacy > 0) {
    log.warn("Users without a username were found; they cannot sign in until migrated", {
      count: legacy,
      fix: "npm run users:migrate-usernames",
    });
  }

  if (await User.exists({ role: "admin" })) return;

  const name = process.env.ADMIN_NAME?.trim() || "Administrator";
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    log.warn("No admin exists and ADMIN_USERNAME / ADMIN_PASSWORD are not set; skipping admin bootstrap");
    return;
  }
  if (!USERNAME_RE.test(username) || password.length < 8) {
    log.error("ADMIN_USERNAME is invalid or ADMIN_PASSWORD is shorter than 8 characters; skipping admin bootstrap");
    return;
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({ name, username, passwordHash, role: "admin", isActive: true, assignedSites: [] });
    log.info("Initial admin account created", { username });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      log.warn("Admin bootstrap skipped: username already exists", { username });
    } else {
      log.error("Admin bootstrap failed", errInfo(e));
    }
  }
}
