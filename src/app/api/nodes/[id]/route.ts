import { ApiError, assertObjectId, ok, parseBody, requirePermission, requireUser, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Node, Site } from "@/lib/models";
import { canAccessSite } from "@/lib/auth/rbac";
import { nodeUpdateSchema } from "@/lib/validation";
import { serializeNode } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const user = await requireUser();
  assertObjectId(params.id, "Node ID");
  await connectDB();
  const node = await Node.findById(params.id).populate("siteId", "siteCode siteName").lean();
  if (!node) throw new ApiError(404, "Node not found", "NOT_FOUND");
  const siteId = (node.siteId as unknown as { _id: { toString(): string } })?._id ?? node.siteId;
  if (!canAccessSite(user, siteId)) throw new ApiError(403, "You do not have access to this Node", "FORBIDDEN");
  return ok({ node: serializeNode(node) });
});

/**
 * Updates name, Site, status or sensor configuration. Node ID is immutable.
 * Historical SensorReading documents are never modified or deleted here.
 */
export const PATCH = route(async (req, { params }) => {
  const user = await requireUser();
  requirePermission(user, "nodes:manage", "You do not have permission to edit Nodes");
  assertObjectId(params.id, "Node ID");
  const body = await parseBody(req, nodeUpdateSchema);
  if (Object.keys(body).length === 0) throw new ApiError(400, "No changes supplied");
  await connectDB();
  if (body.siteId && !(await Site.exists({ _id: body.siteId }))) {
    throw new ApiError(400, "Please select a valid Site", "INVALID_SITE");
  }
  const node = await Node.findByIdAndUpdate(params.id, { $set: body }, { new: true, runValidators: true })
    .populate("siteId", "siteCode siteName")
    .lean();
  if (!node) throw new ApiError(404, "Node not found", "NOT_FOUND");
  return ok({ node: serializeNode(node) });
});
