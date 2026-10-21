/**
 * Shared sensor protocol definitions (safe for browser and server).
 *
 * Configured quantity vs. actual channel IDs
 * ------------------------------------------
 * A Node's sensor configuration (e.g. `{ sensorType: "VMR", quantity: 3 }`) is
 * capacity metadata entered by an administrator. It never generates readings
 * or sensor IDs. Actual sensor IDs (e.g. `VMR_R`, `VMR_Y`, `VMR_B`, `RES_0`)
 * are only learned from real device messages and are recorded on the Node as
 * `discoveredSensors`.
 */

export const SENSOR_TYPES = ["RES", "NER", "VMR", "SPD", "GN", "TEMP", "HUM"] as const;
export type SensorType = (typeof SENSOR_TYPES)[number];

export const SENSOR_TYPE_LABELS: Record<SensorType, string> = {
  RES: "RES — Resistance",
  NER: "NER — Neutral-earth resistance",
  VMR: "VMR — Voltage (R/Y/B)",
  SPD: "SPD — Surge protection (R/Y/B)",
  GN: "GN — no confirmed channel mapping",
  TEMP: "TEMP — Temperature",
  HUM: "HUM — Humidity",
};

/** Keys in a decoded message that are control/meta fields, never sensor readings. */
export const CONTROL_KEYS = ["initialStart", "start", "end"] as const;
export const ALARM_KEY = "alarm";

/**
 * Channel key patterns confirmed by the established device message format.
 *
 * GN: the Phase 1 configuration allows GN as a sensor type, but no GN channel
 * key has been confirmed in real device payloads. Until it is, GN keys are NOT
 * mapped (they stay in the stored raw payload but are not offered as chart
 * sensors). To enable once confirmed, add e.g. `{ type: "GN", re: /^GN_\d+$/ }`.
 */
const CHANNEL_PATTERNS: ReadonlyArray<{ type: SensorType; re: RegExp }> = [
  { type: "RES", re: /^RES_\d{1,3}$/ },
  { type: "NER", re: /^NER_\d{1,3}$/ },
  { type: "VMR", re: /^VMR_[RYB]$/ },
  { type: "SPD", re: /^SPD_[RYB]$/ },
  { type: "TEMP", re: /^Temp$/ },
  { type: "HUM", re: /^Hum$/ },
];

/** Returns the sensor type for an exact channel key, or null when not a known sensor channel. */
export function sensorTypeOf(key: string): SensorType | null {
  for (const p of CHANNEL_PATTERNS) if (p.re.test(key)) return p.type;
  return null;
}

export function isSensorKey(key: string): boolean {
  return sensorTypeOf(key) !== null;
}

/** Sensor ID syntax accepted in API/WebSocket requests (prevents operator/field injection). */
export const SENSOR_ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const PHASE_ORDER: Record<string, number> = { R: 0, Y: 1, B: 2 };

/** Stable ordering: by sensor type order, then channel index (0,1,2… or R,Y,B), then name. */
export function compareSensorIds(a: string, b: string): number {
  const ta = sensorTypeOf(a);
  const tb = sensorTypeOf(b);
  const ia = ta ? SENSOR_TYPES.indexOf(ta) : 99;
  const ib = tb ? SENSOR_TYPES.indexOf(tb) : 99;
  if (ia !== ib) return ia - ib;
  const sa = a.split("_")[1] ?? "";
  const sb = b.split("_")[1] ?? "";
  const na = /^\d+$/.test(sa) ? Number(sa) : PHASE_ORDER[sa] ?? 50;
  const nb = /^\d+$/.test(sb) ? Number(sb) : PHASE_ORDER[sb] ?? 50;
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

export function sortSensorIds(ids: Iterable<string>): string[] {
  return Array.from(new Set(ids)).sort(compareSensorIds);
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export interface Thresholds {
  low?: number | null;
  high?: number | null;
}

export interface SensorOverride extends Thresholds {
  sensorId: string;
}

export interface SensorConfigLike {
  sensorType: SensorType;
  quantity: number;
  thresholds?: Thresholds | null;
  overrides?: SensorOverride[] | null;
}

export type ThresholdStatus = "normal" | "low" | "high" | "unconfigured";

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Resolves the thresholds that apply to one sensor ID: a sensor-specific override wins over the type default. */
export function resolveThresholds(
  sensorId: string,
  configs: SensorConfigLike[] | undefined | null,
): Thresholds | null {
  const type = sensorTypeOf(sensorId);
  if (!type || !configs) return null;
  const cfg = configs.find((c) => c.sensorType === type);
  if (!cfg) return null;
  const ov = cfg.overrides?.find((o) => o.sensorId === sensorId);
  const src = ov && (isNum(ov.low) || isNum(ov.high)) ? ov : cfg.thresholds;
  if (!src || (!isNum(src.low) && !isNum(src.high))) return null;
  return { low: isNum(src.low) ? src.low : null, high: isNum(src.high) ? src.high : null };
}

/** Classifies a value against configured thresholds. Never invents a limit. */
export function classifyValue(value: number, t: Thresholds | null): ThresholdStatus {
  if (!t || (!isNum(t.low) && !isNum(t.high))) return "unconfigured";
  if (isNum(t.low) && value < t.low) return "low";
  if (isNum(t.high) && value > t.high) return "high";
  return "normal";
}

/** Stable, distinct line colours per sensor ID (derived from ID, independent of selection order). */
const PALETTE = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2",
  "#db2777", "#4d7c0f", "#7c3aed", "#ea580c", "#0d9488", "#be123c",
];
const FIXED_COLORS: Record<string, string> = {
  RES_0: "#2563eb", RES_1: "#0891b2", NER_0: "#9333ea", NER_1: "#db2777",
  VMR_R: "#dc2626", VMR_Y: "#ca8a04", VMR_B: "#1d4ed8",
  SPD_R: "#ea580c", SPD_Y: "#65a30d", SPD_B: "#0e7490",
  Temp: "#d97706", Hum: "#0d9488",
};
export function colorForSensor(sensorId: string): string {
  if (FIXED_COLORS[sensorId]) return FIXED_COLORS[sensorId];
  let h = 0;
  for (let i = 0; i < sensorId.length; i++) h = (h * 31 + sensorId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
