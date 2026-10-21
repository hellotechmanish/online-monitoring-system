import { ok, route } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () => {
  clearSessionCookie();
  return ok({ ok: true });
});
