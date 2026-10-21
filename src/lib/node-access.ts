import { ApiError } from "./api";
import { connectDB } from "./db";
import { Node } from "./models";
import { canAccessSite, type SessionUser } from "./auth/rbac";

/** Loads a Node by numeric device ID and verifies the user may access its Site. */
export async function getAccessibleNode(user: SessionUser, nodeId: number) {
  await connectDB();
  const node = await Node.findOne({ nodeId }).lean();
  if (!node) throw new ApiError(404, "Node not found", "NOT_FOUND");
  if (!canAccessSite(user, node.siteId)) throw new ApiError(403, "You do not have access to this Node", "FORBIDDEN");
  return node;
}
