import bcrypt from "bcryptjs";
import {
  ApiError,
  escapeRegex,
  ok,
  pagination,
  parseBody,
  requirePermission,
  requireUser,
  route,
} from "@/lib/api";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { assertSitesExist } from "@/lib/site-helpers";
import { creatableRoles } from "@/lib/auth/rbac";
import { rateLimit } from "@/lib/auth/rate-limit";
import { userCreateSchema } from "@/lib/validation";
import { serializeUser } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const me = await requireUser();
  requirePermission(me, "users:view");
  await connectDB();
  const { page, limit, skip, q } = pagination(req);
  const filter: Record<string, unknown> = {};
  if (me.role !== "admin") filter.role = { $ne: "admin" };
  const role = req.nextUrl.searchParams.get("role");
  if (role === "admin" || role === "technician" || role === "user") {
    if (me.role !== "admin" && role === "admin")
      return ok({ items: [], total: 0, page, limit });
    filter.role = role;
  }
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ name: re }, { username: re }];
  }
  const [docs, total] = await Promise.all([
    User.find(filter)
      .sort({ role: 1, username: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return ok({ items: docs.map(serializeUser), total, page, limit });
});

export const POST = route(async (req) => {
  const me = await requireUser();
  requirePermission(
    me,
    "users:create",
    "You do not have permission to create users",
  );
  if (!rateLimit(`user-create:${me.id}`, 30, 15 * 60_000).ok) {
    throw new ApiError(
      429,
      "Too many accounts created recently. Try again later.",
      "RATE_LIMITED",
    );
  }
  const body = await parseBody(req, userCreateSchema);
  if (!creatableRoles(me).includes(body.role)) {
    throw new ApiError(
      403,
      `You cannot create ${body.role} accounts`,
      "FORBIDDEN",
    );
  }
  await connectDB();
  if (await User.exists({ username: body.username }))
    throw new ApiError(409, "Username already exists", "DUPLICATE");
  const assignedSites = await assertSitesExist(body.assignedSites);
  const passwordHash = await bcrypt.hash(body.password, 12);
  // Unique index on username rejects duplicates, including concurrent creation.
  const user = await User.create({
    name: body.name,
    username: body.username,
    passwordHash,
    role: body.role,
    assignedSites,
    isActive: body.isActive,
  });
  return ok({ user: serializeUser(user.toObject()) }, 201);
});
