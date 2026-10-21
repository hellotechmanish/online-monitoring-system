import { Types } from "mongoose";
import { connectDB } from "../db";
import { User } from "../models";
import type { SessionUser } from "./rbac";
import type { Role } from "../validation";

export interface UserRecordLike {
  _id: Types.ObjectId | string;
  name: string;
  username: string;
  role: string;
  assignedSites?: Array<Types.ObjectId | string> | null;
}

export function toSessionUser(u: UserRecordLike): SessionUser {
  return {
    id: u._id.toString(),
    name: u.name,
    username: u.username,
    role: u.role as Role,
    assignedSites: (u.assignedSites ?? []).map((s) => s.toString()),
  };
}

/**
 * Loads a user for verified token claims. Rejects inactive users, accounts
 * without a username, and revoked sessions (sessionVersion mismatch).
 * Pass `sv = null` to skip the session-version check (used to re-validate an
 * already-authenticated WebSocket connection).
 */
export async function loadUserForClaims(sub: string, sv: number | null): Promise<SessionUser | null> {
  if (!Types.ObjectId.isValid(sub)) return null;
  await connectDB();
  const u = await User.findById(sub).select("name username role assignedSites isActive sessionVersion").lean();
  if (!u || !u.isActive || !u.username) return null;
  if (sv !== null && (u.sessionVersion ?? 0) !== sv) return null;
  return toSessionUser(u as UserRecordLike);
}
