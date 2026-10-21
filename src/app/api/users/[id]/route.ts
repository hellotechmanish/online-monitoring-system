import bcrypt from "bcryptjs";
import { ApiError, assertObjectId, ok, parseBody, requirePermission, requireUser, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { canManageAccount, creatableRoles } from "@/lib/auth/rbac";
import { userUpdateSchema, type Role } from "@/lib/validation";
import { serializeUser } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const me = await requireUser();
  requirePermission(me, "users:view");
  assertObjectId(params.id, "User ID");
  await connectDB();
  const u = await User.findById(params.id).lean();
  if (!u || (u.role === "admin" && me.role !== "admin")) throw new ApiError(404, "User not found", "NOT_FOUND");
  return ok({ user: serializeUser(u) });
});

export const PATCH = route(async (req, { params }) => {
  const me = await requireUser();
  requirePermission(me, "users:create");
  assertObjectId(params.id, "User ID");
  const body = await parseBody(req, userUpdateSchema);
  await connectDB();
  const target = await User.findById(params.id).select("+passwordHash");
  if (!target) throw new ApiError(404, "User not found", "NOT_FOUND");
  if (!canManageAccount(me, target.role as Role, target._id.toString())) {
    throw new ApiError(403, "You do not have permission to edit this account", "FORBIDDEN");
  }
  if (body.role && body.role !== target.role && !creatableRoles(me).includes(body.role)) {
    throw new ApiError(403, `You cannot assign the ${body.role} role`, "FORBIDDEN");
  }
  let revoke = false;
  if (body.name !== undefined) target.name = body.name;
  if (body.username !== undefined && body.username !== target.username) {
    if (await User.exists({ username: body.username, _id: { $ne: target._id } })) throw new ApiError(409, "Username already exists", "DUPLICATE");
    target.username = body.username;
  }
  if (body.role !== undefined && body.role !== target.role) {
    target.role = body.role;
    revoke = true;
  }
  if (body.isActive !== undefined && body.isActive !== target.isActive) {
    target.isActive = body.isActive;
    if (!body.isActive) revoke = true;
  }
  if (body.password !== undefined) {
    target.passwordHash = await bcrypt.hash(body.password, 12);
    revoke = true;
  }
  if (revoke) target.sessionVersion = (target.sessionVersion ?? 0) + 1;
  await target.save();
  return ok({ user: serializeUser(target.toObject()) });
});
