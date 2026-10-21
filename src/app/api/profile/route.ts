import { ok, parseBody, requireUser, route } from "@/lib/api";
import { User } from "@/lib/models";
import { profileUpdateSchema } from "@/lib/validation";
import { serializeUser } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Self-service profile update: only the display name. Role, username, sites are admin-managed. */
export const PATCH = route(async (req) => {
  const me = await requireUser();
  const body = await parseBody(req, profileUpdateSchema);
  const u = await User.findByIdAndUpdate(me.id, { $set: { name: body.name } }, { new: true, runValidators: true }).lean();
  return ok({ user: serializeUser(u) });
});
