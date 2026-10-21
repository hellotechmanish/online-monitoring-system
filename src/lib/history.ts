import type { HistoryPoint } from "./types";

export interface StoredReadingLike {
  receivedAt: Date | string;
  data: Record<string, unknown>;
}

/**
 * Builds chart points from stored multi-key message documents.
 *
 * `fetchForSensor(sensorId, limit)` must return the newest `limit` documents
 * that contain that sensor key (newest first). Querying per sensor guarantees
 * each selected series gets up to `limit` points, instead of a shared limit
 * that could leave some series empty. Documents are never modified; requested
 * keys are extracted into points, merged by timestamp, and returned oldest → newest.
 */
export async function buildHistory(
  sensors: string[],
  limit: number,
  fetchForSensor: (sensorId: string, limit: number) => Promise<StoredReadingLike[]>,
): Promise<HistoryPoint[]> {
  const byTime = new Map<number, HistoryPoint>();
  const results = await Promise.all(sensors.map(async (s) => [s, await fetchForSensor(s, limit)] as const));
  for (const [sensorId, docs] of results) {
    for (const doc of docs.slice(0, limit)) {
      const v = doc.data?.[sensorId];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const t = new Date(doc.receivedAt).getTime();
      if (!Number.isFinite(t)) continue;
      let p = byTime.get(t);
      if (!p) {
        p = { timestamp: new Date(t).toISOString(), values: {} };
        byTime.set(t, p);
      }
      p.values[sensorId] = v;
      const alarm = doc.data?.alarm;
      if (typeof alarm === "number" && Number.isFinite(alarm)) p.alarm = alarm;
    }
  }
  return Array.from(byTime.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p);
}
