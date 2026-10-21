import { Suspense } from "react";
import { MonitoringView } from "@/components/monitoring/monitoring-view";
import { Skeleton } from "@/components/ui/misc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monitoring" };

/**
 * URL state: /monitoring?siteId=<id>&nodeId=1001&sensors=RES_0,RES_1
 * Every value is re-validated by the APIs and the WebSocket service; the page
 * only shows Sites/Nodes the server returned for this user.
 */
export default function MonitoringPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <MonitoringView />
    </Suspense>
  );
}
