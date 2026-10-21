import { ApiError, ok, parseBody, pagination, requirePermission, requireUser, route, escapeRegex } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Node, Site } from "@/lib/models";
import { siteScopeFilter } from "@/lib/auth/rbac";
import { siteCreateSchema } from "@/lib/validation";
import { serializeSite } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireUser();
  await connectDB();
  const { page, limit, skip, q } = pagination(req, req.nextUrl.searchParams.get("all") === "1" ? 500 : 100);
  const filter: Record<string, unknown> = { ...siteScopeFilter(user) };
  const status = req.nextUrl.searchParams.get("status");
  if (status === "active" || status === "inactive") filter.status = status;
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ siteCode: re }, { siteName: re }, { location: re }];
  }
  const [docs, total] = await Promise.all([
    Site.find(filter).sort({ siteCode: 1 }).skip(skip).limit(limit).lean(),
    Site.countDocuments(filter),
  ]);
  const counts = await Promise.all(docs.map((d) => Node.countDocuments({ siteId: d._id })));
  return ok({ items: docs.map((d, i) => serializeSite(d, counts[i])), total, page, limit });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  requirePermission(user, "sites:manage", "You do not have permission to create Sites");
  const body = await parseBody(req, siteCreateSchema);
  await connectDB();
  if (await Site.exists({ siteCode: body.siteCode })) throw new ApiError(409, "Site code already exists", "DUPLICATE");
  const site = await Site.create(body); // unique index still guards concurrent requests
  return ok({ site: serializeSite(site.toObject(), 0) }, 201);
});
