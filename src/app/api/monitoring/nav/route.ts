import { ok, requireUser, route } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Node, Site } from "@/lib/models";
import { siteScopeFilter } from "@/lib/auth/rbac";
import type { MonitoringNavSite } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sites the user may monitor, each with its Nodes (for the sidebar and Monitoring page). */
export const GET = route(async () => {
  const user = await requireUser();
  await connectDB();
  const sites = await Site.find(siteScopeFilter(user)).sort({ siteCode: 1 }).limit(300).lean();
  const nodes = await Node.find({ siteId: { $in: sites.map((s) => s._id) } })
    .select("nodeId nodeName siteId status")
    .sort({ nodeId: 1 })
    .lean();
  const bySite = new Map<string, MonitoringNavSite["nodes"]>();
  for (const n of nodes) {
    const k = n.siteId.toString();
    if (!bySite.has(k)) bySite.set(k, []);
    bySite.get(k)!.push({ id: n._id.toString(), nodeId: n.nodeId, nodeName: n.nodeName, status: n.status });
  }
  const items: MonitoringNavSite[] = sites.map((s) => ({
    id: s._id.toString(),
    siteCode: s.siteCode,
    siteName: s.siteName,
    status: s.status,
    nodes: bySite.get(s._id.toString()) ?? [],
  }));
  return ok({ items });
});
