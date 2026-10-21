import { ApiError, ok, requirePermission, requireUser, route } from "@/lib/api";
import { User } from "@/lib/models";
import { signWsToken, WS_TOKEN_TTL_SECONDS } from "@/lib/auth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issues a 60-second token used once to authenticate the WebSocket connection. */
export const GET = route(async () => {
  const user = await requireUser();
  requirePermission(user, "monitoring:view");
  const u = await User.findById(user.id).select("sessionVersion").lean();
  if (!u) throw new ApiError(401, "Authentication required");
  const token = await signWsToken(user.id, u.sessionVersion ?? 0);
  return ok({ token, expiresIn: WS_TOKEN_TTL_SECONDS, url: process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:3001" });
});
