import { ApiError, assertObjectId, ok, parseBody, requirePermission, requireUser, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Node, Site } from "@/lib/models";
import { canAccessSite } from "@/lib/auth/rbac";
import { siteUpdateSchema } from "@/lib/validation";
import { serializeNode, serializeSite } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const user = await requireUser();
  assertObjectId(params.id, "Site ID");
  await connectDB();
  const site = await Site.findById(params.id).lean();
  if (!site) throw new ApiError(404, "Site not found", "NOT_FOUND");
  if (!canAccessSite(user, site._id)) throw new ApiError(403, "You do not have access to this Site", "FORBIDDEN");
  const nodes = await Node.find({ siteId: site._id }).sort({ nodeId: 1 }).lean();
  return ok({ site: serializeSite(site, nodes.length), nodes: nodes.map(serializeNode) });
});

export const PATCH = route(async (req, { params }) => {
  const user = await requireUser();
  requirePermission(user, "sites:manage", "You do not have permission to edit Sites");
  assertObjectId(params.id, "Site ID");
  const body = await parseBody(req, siteUpdateSchema);
  if (Object.keys(body).length === 0) throw new ApiError(400, "No changes supplied");
  await connectDB();
  if (body.siteCode && (await Site.exists({ siteCode: body.siteCode, _id: { $ne: params.id } }))) {
    throw new ApiError(409, "Site code already exists", "DUPLICATE");
  }
  const site = await Site.findByIdAndUpdate(params.id, { $set: body }, { new: true, runValidators: true }).lean();
  if (!site) throw new ApiError(404, "Site not found", "NOT_FOUND");
  const nodeCount = await Node.countDocuments({ siteId: site._id });
  return ok({ site: serializeSite(site, nodeCount) });
});
