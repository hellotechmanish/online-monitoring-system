/**
 * One-off migration for accounts created before username login existed
 * (Phase 1 used email). For each user without a username:
 *   username = normalized local part of the email (a-z0-9._-, 3–32 chars)
 * Collisions (with existing usernames or between candidates) and invalid
 * candidates are REPORTED and left unchanged — never assigned twice.
 * The email field is kept. Dry-run by default; pass --apply to write.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);
import { connectDB, disconnectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { USERNAME_RE } from "@/lib/validation";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();
  const missing = await User.find({ $or: [{ username: { $exists: false } }, { username: null }, { username: "" }] })
    .select("_id email name")
    .lean();
  const taken = new Set((await User.find({ username: { $nin: [null, ""] } }).select("username").lean()).map((u) => u.username));
  const candidates = new Map<string, string[]>();
  const problems: string[] = [];
  for (const u of missing) {
    const email = (u.email ?? "").toLowerCase();
    const local = email.split("@")[0]?.replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "").slice(0, 32) ?? "";
    if (!local || !USERNAME_RE.test(local)) {
      problems.push(`${u._id}: cannot derive a valid username from "${email || "(no email)"}" — set one manually`);
      continue;
    }
    candidates.set(local, [...(candidates.get(local) ?? []), u._id.toString()]);
  }
  let applied = 0;
  for (const [name, ids] of candidates) {
    if (ids.length > 1 || taken.has(name)) {
      problems.push(`collision on "${name}" for users ${ids.join(", ")} — set usernames manually`);
      continue;
    }
    console.log(`${apply ? "SET" : "WOULD SET"} ${ids[0]} → ${name}`);
    if (apply) {
      await User.updateOne({ _id: ids[0], $or: [{ username: { $exists: false } }, { username: null }, { username: "" }] }, { $set: { username: name } });
      applied++;
    }
  }
  for (const p of problems) console.warn("SKIPPED:", p);
  console.log(`${missing.length} account(s) without username; ${apply ? `${applied} updated` : "dry run (use --apply)"}; ${problems.length} need manual action.`);
  await disconnectDB();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
