import { sortSensorIds } from "./protocol/sensors";
import type { NodeDTO, SiteDTO, UserDTO, SensorConfigDTO } from "./types";
import type { Role } from "./validation";

const iso = (d: any): string | undefined => (d ? new Date(d).toISOString() : undefined);

export function serializeSite(s: any, nodeCount?: number): SiteDTO {
  return {
    id: s._id.toString(),
    siteCode: s.siteCode,
    siteName: s.siteName,
    location: s.location ?? "",
    description: s.description ?? "",
    status: s.status,
    ...(nodeCount !== undefined ? { nodeCount } : {}),
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
  };
}

export function serializeSensors(sensors: any[] | undefined): SensorConfigDTO[] {
  return (sensors ?? []).map((c) => ({
    sensorType: c.sensorType,
    quantity: c.quantity,
    thresholds: { low: c.thresholds?.low ?? null, high: c.thresholds?.high ?? null },
    overrides: (c.overrides ?? []).map((o: any) => ({ sensorId: o.sensorId, low: o.low ?? null, high: o.high ?? null })),
  }));
}

export function serializeNode(n: any): NodeDTO {
  const site = n.siteId && typeof n.siteId === "object" && "siteCode" in n.siteId ? n.siteId : null;
  return {
    id: n._id.toString(),
    nodeId: n.nodeId,
    nodeName: n.nodeName,
    siteId: site ? site._id.toString() : n.siteId?.toString(),
    site: site ? { id: site._id.toString(), siteCode: site.siteCode, siteName: site.siteName } : undefined,
    sensors: serializeSensors(n.sensors),
    status: n.status ?? "offline",
    discoveredSensors: sortSensorIds((n.discoveredSensors ?? []).map((d: any) => d.sensorId)),
    lastReadingAt: n.lastReadingAt ? new Date(n.lastReadingAt).toISOString() : null,
    createdAt: iso(n.createdAt),
    updatedAt: iso(n.updatedAt),
  };
}

export function serializeUser(u: any): UserDTO {
  return {
    id: u._id.toString(),
    name: u.name,
    username: u.username,
    role: u.role as Role,
    assignedSites: (u.assignedSites ?? []).map((s: any) => (s?._id ?? s).toString()),
    isActive: u.isActive !== false,
    createdAt: iso(u.createdAt),
  };
}
