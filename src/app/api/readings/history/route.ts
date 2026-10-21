import { ApiError, ok, parseQuery, requireUser, route } from "@/lib/api";
import { SensorReading } from "@/lib/models";
import { historyQuerySchema } from "@/lib/validation";
import { getAccessibleNode } from "@/lib/node-access";
import { buildHistory, type StoredReadingLike } from "@/lib/history";
import { sensorTypeOf, sortSensorIds } from "@/lib/protocol/sensors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/readings/history?nodeId=1001&sensors=RES_0,RES_1&limit=20
 * Returns the latest `limit` persisted points PER sensor, oldest → newest.
 */
export const GET = route(async (req) => {
  const user = await requireUser();
  const { nodeId, sensors, limit } = parseQuery(req, historyQuerySchema);
  const invalid = sensors.filter((s) => !sensorTypeOf(s));
  if (invalid.length) throw new ApiError(400, `Unsupported sensor ID: ${invalid.join(", ")}`, "INVALID_SENSOR");
  const node = await getAccessibleNode(user, nodeId);
  const ordered = sortSensorIds(sensors);

  const points = await buildHistory(ordered, limit, async (sensorId, lim) => {
    // sensorId is validated against a strict channel pattern, so the dotted path is safe.
    const docs = await SensorReading.find({ nodeId: node.nodeId, [`data.${sensorId}`]: { $exists: true } })
      .sort({ receivedAt: -1 })
      .limit(lim)
      .select({ receivedAt: 1, data: 1 })
      .lean();
    return docs as unknown as StoredReadingLike[];
  });

  return ok({ nodeId: node.nodeId, sensors: ordered, points });
});
