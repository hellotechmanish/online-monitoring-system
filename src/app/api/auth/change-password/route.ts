import bcrypt from "bcryptjs";
import { ApiError, ok, parseBody, requireUser, route } from "@/lib/api";
import { User } from "@/lib/models";
import { changePasswordSchema } from "@/lib/validation";
import { setSessionCookie } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const me = await requireUser();
  if (!rateLimit(`pw:${me.id}`, 10, 15 * 60_000).ok) throw new ApiError(429, "Too many attempts. Try again later.");
  const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema);
  const user = await User.findById(me.id).select("+passwordHash sessionVersion");
  if (!user) throw new ApiError(401, "Authentication required");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ApiError(400, "Current password is incorrect", "INVALID_PASSWORD");
  }
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.sessionVersion = (user.sessionVersion ?? 0) + 1; // revokes other sessions
  await user.save();
  await setSessionCookie(user._id.toString(), user.sessionVersion);
  return ok({ ok: true });
});
