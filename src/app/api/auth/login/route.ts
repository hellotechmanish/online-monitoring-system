import bcrypt from "bcryptjs";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { loginSchema } from "@/lib/validation";
import { rateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { setSessionCookie, toSessionUser, type UserRecordLike } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Compared against when the username does not exist, so response timing stays similar.
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("derms-timing-equalizer", 12));

export const POST = route(async (req) => {
  const { username, password } = await parseBody(req, loginSchema);
  const ip = clientIp(req);
  const perUser = rateLimit(`login:${ip}:${username}`, 10, 15 * 60_000);
  const perIp = rateLimit(`login-ip:${ip}`, 100, 15 * 60_000);
  if (!perUser.ok || !perIp.ok) {
    throw new ApiError(429, "Too many sign-in attempts. Please try again later.", "RATE_LIMITED");
  }

  await connectDB();
  const user = await User.findOne({ username }).select("+passwordHash").lean();
  const valid = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());
  if (!user || !valid) throw new ApiError(401, "Invalid username or password", "INVALID_CREDENTIALS");
  if (!user.isActive) throw new ApiError(403, "This account is deactivated. Contact an administrator.", "INACTIVE");
  if (user.role !== "admin") {
    const s = await getSettings();
    if (s.maintenanceMode) throw new ApiError(503, "The system is under maintenance. Only administrators can sign in.", "MAINTENANCE");
  }

  resetRateLimit(`login:${ip}:${username}`);
  await setSessionCookie(user._id.toString(), user.sessionVersion ?? 0);
  return ok({ user: toSessionUser(user as UserRecordLike) });
});
