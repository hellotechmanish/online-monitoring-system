import { ok, pagination, requirePermission, requireUser, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Node, SensorReading } from "@/lib/models";
import { nodeScopeFilter } from "@/lib/auth/rbac";
import { getAccessibleNode } from "@/lib/node-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Paginated stored readings (original decoded payloads). Only returns persisted data. */
export const GET = route(async (req) => {
  const user = await requireUser();
  requirePermission(user, "monitoring:view");
  await connectDB();
  const { page, limit, skip } = pagination(req, 200);
  const raw = req.nextUrl.searchParams.get("nodeId");
  const filter: Record<string, unknown> = {};
  if (raw) {
    const node = await getAccessibleNode(user, Number.parseInt(raw, 10) || -1);
    filter.nodeId = node.nodeId;
  } else {
    const nodes = await Node.find(nodeScopeFilter(user)).select("nodeId").lean();
    filter.nodeId = { $in: nodes.map((n) => n.nodeId) };
  }
  const [docs, total] = await Promise.all([
    SensorReading.find(filter).sort({ receivedAt: -1 }).skip(skip).limit(limit).lean(),
    SensorReading.countDocuments(filter),
  ]);
  return ok({
    items: docs.map((d) => ({
      id: d._id.toString(),
      nodeId: d.nodeId,
      data: d.data,
      receivedAt: new Date(d.receivedAt).toISOString(),
    })),
    total,
    page,
    limit,
  });
});
