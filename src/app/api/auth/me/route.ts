import { ok, requireUser, route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  return ok({ user });
});
