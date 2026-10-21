/** JSON DTOs exchanged between API routes and the browser. */
import type { SensorType } from "./protocol/sensors";
import type { Role } from "./validation";

export interface SiteDTO {
  id: string;
  siteCode: string;
  siteName: string;
  location: string;
  description: string;
  status: "active" | "inactive";
  nodeCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SensorConfigDTO {
  sensorType: SensorType;
  quantity: number;
  thresholds: { low: number | null; high: number | null };
  overrides: Array<{ sensorId: string; low: number | null; high: number | null }>;
}

export interface NodeDTO {
  id: string;
  nodeId: number;
  nodeName: string;
  siteId: string;
  site?: { id: string; siteCode: string; siteName: string } | null;
  sensors: SensorConfigDTO[];
  status: "online" | "offline";
  /** Sensor channel IDs observed in real device messages, in stable order. */
  discoveredSensors: string[];
  lastReadingAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserDTO {
  id: string;
  name: string;
  username: string;
  role: Role;
  assignedSites: string[];
  isActive: boolean;
  createdAt?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface HistoryPoint {
  timestamp: string;
  values: Record<string, number>;
  alarm?: number | null;
}

export interface HistoryResponse {
  nodeId: number;
  sensors: string[];
  points: HistoryPoint[];
}

export interface MonitoringNavSite {
  id: string;
  siteCode: string;
  siteName: string;
  status: "active" | "inactive";
  nodes: Array<{ id: string; nodeId: number; nodeName: string; status: "online" | "offline" }>;
}
