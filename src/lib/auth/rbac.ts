/**
 * Central role-based access rules. Pure functions, shared by API routes,
 * server components, the WebSocket service and (for UI visibility only) the client.
 * UI visibility is never a substitute for these server-side checks.
 */
import type { Role } from "../validation";

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: Role;
  assignedSites: string[];
}

export type Permission =
  | "sites:view_all"
  | "sites:manage"
  | "nodes:view_all"
  | "nodes:manage"
  | "readings:view_all"
  | "users:view"
  | "users:create"
  | "users:assign_sites"
  | "settings:manage"
  | "monitoring:view";

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    "sites:view_all", "sites:manage", "nodes:view_all", "nodes:manage", "readings:view_all",
    "users:view", "users:create", "users:assign_sites", "settings:manage", "monitoring:view",
  ]),
  technician: new Set<Permission>([
    "sites:view_all", "nodes:view_all", "readings:view_all", "users:view", "users:create",
    "users:assign_sites", "monitoring:view",
  ]),
  user: new Set<Permission>(["monitoring:view"]),
};

export function can(user: Pick<SessionUser, "role"> | null | undefined, p: Permission): boolean {
  return !!user && MATRIX[user.role]?.has(p) === true;
}

/** Site-level access: admin/technician see every Site; a User only assigned Sites. */
export function canAccessSite(user: SessionUser, siteId: string | { toString(): string }): boolean {
  if (can(user, "sites:view_all")) return true;
  const id = siteId.toString();
  return user.assignedSites.includes(id);
}

/** Mongo filter restricting Sites to those the user may see. */
export function siteScopeFilter(user: SessionUser): Record<string, unknown> {
  return can(user, "sites:view_all") ? {} : { _id: { $in: user.assignedSites } };
}

/** Mongo filter restricting Nodes to those in Sites the user may see. */
export function nodeScopeFilter(user: SessionUser): Record<string, unknown> {
  return can(user, "nodes:view_all") ? {} : { siteId: { $in: user.assignedSites } };
}

/** Which roles an actor may create. Nobody may create an admin through the API. */
export function creatableRoles(actor: Pick<SessionUser, "role">): Role[] {
  if (actor.role === "admin") return ["technician", "user"];
  if (actor.role === "technician") return ["user"];
  return [];
}

/** Whether an actor may edit/assign another account with the given role. */
export function canManageAccount(actor: SessionUser, targetRole: Role, targetId: string): boolean {
  if (targetId === actor.id) return false; // self-service goes through /api/auth & profile
  if (actor.role === "admin") return targetRole !== "admin";
  if (actor.role === "technician") return targetRole === "user";
  return false;
}
