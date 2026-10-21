import { ApiError } from "./api";
import { Site } from "./models";

/** Ensures every referenced Site exists; returns de-duplicated IDs. */
export async function assertSitesExist(ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return unique;
  const count = await Site.countDocuments({ _id: { $in: unique } });
  if (count !== unique.length) throw new ApiError(400, "One or more selected Sites do not exist", "INVALID_SITE");
  return unique;
}
