import { Types } from "mongoose";
import { ApiError, escapeRegex, ok, pagination, parseBody, requirePermission, requireUser, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Node, Site } from "@/lib/models";
import { canAccessSite, nodeScopeFilter } from "@/lib/auth/rbac";
import { nodeCreateSchema } from "@/lib/validation";
import { serializeNode } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireUser();
  await connectDB();
  const { page, limit, skip, q } = pagination(req);
  const sp = req.nextUrl.searchParams;
  const filter: Record<string, unknown> = { ...nodeScopeFilter(user) };
  const siteId = sp.get("siteId");
  if (siteId) {
    if (!Types.ObjectId.isValid(siteId)) throw new ApiError(400, "Invalid Site ID");
    if (!canAccessSite(user, siteId)) throw new ApiError(403, "You do not have access to this Site", "FORBIDDEN");
    filter.siteId = siteId;
  }
  const status = sp.get("status");
  if (status === "online" || status === "offline") filter.status = status;
  if (q) {
    const ors: Record<string, unknown>[] = [{ nodeName: new RegExp(escapeRegex(q), "i") }];
    if (/^\d{1,9}$/.test(q)) ors.push({ nodeId: Number(q) });
    filter.$or = ors;
  }
  const [docs, total] = await Promise.all([
    Node.find(filter).sort({ nodeId: 1 }).skip(skip).limit(limit).populate("siteId", "siteCode siteName").lean(),
    Node.countDocuments(filter),
  ]);
  return ok({ items: docs.map(serializeNode), total, page, limit });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  requirePermission(user, "nodes:manage", "You do not have permission to create Nodes");
  const body = await parseBody(req, nodeCreateSchema);
  await connectDB();
  const site = await Site.findById(body.siteId).select("_id").lean();
  if (!site) throw new ApiError(400, "Please select a valid Site", "INVALID_SITE");
  if (await Node.exists({ nodeId: body.nodeId })) throw new ApiError(409, "Node ID already exists", "DUPLICATE");
  // The unique index on nodeId still guarantees uniqueness under concurrent requests.
  const node = await Node.create({
    nodeId: body.nodeId,
    nodeName: body.nodeName,
    siteId: site._id,
    sensors: body.sensors,
    status: "offline",
  });
  return ok({ node: serializeNode(node.toObject()) }, 201);
});
