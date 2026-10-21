import { ApiError, assertObjectId, ok, parseBody, requirePermission, requireUser, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { canManageAccount } from "@/lib/auth/rbac";
import { assignSitesSchema, type Role } from "@/lib/validation";
import { serializeUser } from "@/lib/serialize";
import { assertSitesExist } from "@/lib/site-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route(async (req, { params }) => {
  const me = await requireUser();
  requirePermission(me, "users:assign_sites", "You do not have permission to assign Sites");
  assertObjectId(params.id, "User ID");
  const { assignedSites } = await parseBody(req, assignSitesSchema);
  await connectDB();
  const target = await User.findById(params.id);
  if (!target) throw new ApiError(404, "User not found", "NOT_FOUND");
  if (!canManageAccount(me, target.role as Role, target._id.toString())) {
    throw new ApiError(403, "You do not have permission to assign Sites to this account", "FORBIDDEN");
  }
  target.set("assignedSites", await assertSitesExist(assignedSites));
  await target.save();
  return ok({ user: serializeUser(target.toObject()) });
});
