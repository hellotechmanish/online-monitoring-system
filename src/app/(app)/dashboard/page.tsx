import Link from "next/link";
import { Activity, Building2, Cpu, Gauge, Users, Wifi, WifiOff } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { can, nodeScopeFilter, siteScopeFilter } from "@/lib/auth/rbac";
import { connectDB } from "@/lib/db";
import { Node, Site, User } from "@/lib/models";
import { Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

function Stat({ label, value, icon, sub, href }: { label: string; value: number | string; icon: React.ReactNode; sub?: React.ReactNode; href?: string }) {
  const body = (
    <Card className="h-full p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</p>
          <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div>
      </div>
      {sub && <div className="mt-2 text-xs text-subtle">{sub}</div>}
    </Card>
  );
  return href ? (
    <Link href={href} className="focus-ring block rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?expired=1");
  await connectDB();
  const sf = siteScopeFilter(user);
  const nf = nodeScopeFilter(user);
  const [totalSites, activeSites, totalNodes, onlineNodes, nodesForSensors, totalUsers] = await Promise.all([
    Site.countDocuments(sf),
    Site.countDocuments({ ...sf, status: "active" }),
    Node.countDocuments(nf),
    Node.countDocuments({ ...nf, status: "online" }),
    Node.find(nf).select("sensors.quantity").lean(),
    can(user, "users:view") ? User.countDocuments(user.role === "admin" ? {} : { role: { $ne: "admin" } }) : Promise.resolve(null),
  ]);
  const configuredSensors = nodesForSensors.reduce(
    (n, node) => n + (node.sensors ?? []).reduce((m, s) => m + (s.quantity ?? 0), 0),
    0,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Dashboard" description="Configuration overview for the Sites you can access." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total Sites" value={totalSites} icon={<Building2 className="h-5 w-5" />} href="/sites"
          sub={<>{activeSites} active · {totalSites - activeSites} inactive</>} />
        <Stat label="Total Nodes" value={totalNodes} icon={<Cpu className="h-5 w-5" />} href="/nodes"
          sub={<span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-success"><Wifi className="h-3 w-3" /> {onlineNodes} online</span>
            <span className="inline-flex items-center gap-1"><WifiOff className="h-3 w-3" /> {totalNodes - onlineNodes} offline</span>
          </span>} />
        <Stat label="Configured sensors" value={configuredSensors} icon={<Gauge className="h-5 w-5" />} sub="Sum of configured quantities (capacity, not live channels)" />
        {totalUsers !== null ? (
          <Stat label="Total Users" value={totalUsers} icon={<Users className="h-5 w-5" />} href="/users" />
        ) : (
          <Stat label="Assigned Sites" value={user.assignedSites.length} icon={<Users className="h-5 w-5" />} />
        )}
      </div>

      <Card className="mt-6">
        <CardHeader title="Live monitoring" description="Real-time readings are delivered over WebSocket from the MQTT realtime service." />
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <p className="max-w-2xl text-sm text-subtle">
            Open the Monitoring page to choose a Site, a Node and one or more sensor channels. The chart restores the last persisted
            points from MongoDB and then appends live values.
          </p>
          <Link href="/monitoring" className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Activity className="h-4 w-4" /> Open Monitoring
          </Link>
        </div>
      </Card>
    </div>
  );
}
