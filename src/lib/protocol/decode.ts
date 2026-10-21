/**
 * MQTT envelope decoding for the DERMS device protocol.
 *
 * Envelope (JSON):   { "Node_Id": 1001, "data": "<encoded-payload>" }
 * Decoded payload:   { "RES_0": 4, "alarm": 0, "start": 1 }  (examples)
 *
 * The publisher source was not available when this was written, so the
 * encoding of `data` is configurable via MQTT_PAYLOAD_ENCODING:
 *   - "base64": `data` is Base64 of a UTF-8 JSON object (the documented format)
 *   - "json":   `data` is a JSON object, or a JSON string of an object
 *   - "auto":   accept either (default). Base64 is attempted first.
 * Confirm against the Python publisher and pin the mode in production.
 */
import { ALARM_KEY, CONTROL_KEYS, sensorTypeOf, type SensorType } from "./sensors";

export type PayloadEncoding = "auto" | "base64" | "json";

export interface DecodedMessage {
  nodeId: number;
  /** Original decoded payload, unmodified. */
  data: Record<string, unknown>;
}

export interface ParsedMessage {
  /** Numeric sensor values keyed by exact sensor ID. */
  values: Record<string, number>;
  /** Device alarm value when present (kept separate from sensor values). */
  alarm: number | null;
  /** Control flags present in the message. */
  control: { initialStart: boolean; start: boolean; end: boolean };
  /** Keys that looked like readings but were rejected (non-numeric, unknown channel). */
  rejected: Array<{ key: string; reason: "non-numeric" | "unknown-channel" }>;
  /** Sensor types seen in this message. */
  types: SensorType[];
}

export class DecodeError extends Error {
  constructor(
    public code:
      | "INVALID_JSON"
      | "INVALID_ENVELOPE"
      | "INVALID_NODE_ID"
      | "INVALID_BASE64"
      | "INVALID_PAYLOAD"
      | "TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "DecodeError";
  }
}

export const MAX_ENVELOPE_BYTES = 16 * 1024;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseNodeId(raw: unknown): number {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && /^\d{1,9}$/.test(raw.trim())) n = Number(raw.trim());
  else throw new DecodeError("INVALID_NODE_ID", "Node_Id must be a positive integer");
  if (!Number.isSafeInteger(n) || n <= 0) throw new DecodeError("INVALID_NODE_ID", "Node_Id must be a positive integer");
  return n;
}

function decodeBase64Json(s: string): Record<string, unknown> {
  const compact = s.replace(/\s+/g, "");
  if (!compact || !BASE64_RE.test(compact)) throw new DecodeError("INVALID_BASE64", "data is not valid Base64");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(compact, "base64").toString("utf8"));
  } catch {
    throw new DecodeError("INVALID_PAYLOAD", "Base64 payload is not valid JSON");
  }
  if (!isPlainObject(parsed)) throw new DecodeError("INVALID_PAYLOAD", "decoded payload must be a JSON object");
  return parsed;
}

function decodeJsonData(d: unknown): Record<string, unknown> {
  if (isPlainObject(d)) return d;
  if (typeof d === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(d);
    } catch {
      throw new DecodeError("INVALID_PAYLOAD", "data is not valid JSON");
    }
    if (isPlainObject(parsed)) return parsed;
  }
  throw new DecodeError("INVALID_PAYLOAD", "data must be a JSON object");
}

/** Decodes a raw MQTT message buffer into node ID and original payload object. */
export function decodeEnvelope(raw: Buffer | string, encoding: PayloadEncoding = "auto"): DecodedMessage {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_ENVELOPE_BYTES) throw new DecodeError("TOO_LARGE", "message too large");
  let env: unknown;
  try {
    env = JSON.parse(text);
  } catch {
    throw new DecodeError("INVALID_JSON", "envelope is not valid JSON");
  }
  if (!isPlainObject(env) || !("Node_Id" in env) || !("data" in env)) {
    throw new DecodeError("INVALID_ENVELOPE", "envelope must contain Node_Id and data");
  }
  const nodeId = parseNodeId(env.Node_Id);
  const d = env.data;
  let data: Record<string, unknown>;
  if (encoding === "base64") {
    if (typeof d !== "string") throw new DecodeError("INVALID_BASE64", "data must be a Base64 string");
    data = decodeBase64Json(d);
  } else if (encoding === "json") {
    data = decodeJsonData(d);
  } else {
    if (typeof d === "string") {
      try {
        data = decodeBase64Json(d);
      } catch (e) {
        try {
          data = decodeJsonData(d);
        } catch {
          throw e;
        }
      }
    } else {
      data = decodeJsonData(d);
    }
  }
  return { nodeId, data };
}

const CONTROL_SET = new Set<string>(CONTROL_KEYS);

/** Splits a decoded payload into sensor values, alarm and control flags. Does not mutate the input. */
export function parsePayload(data: Record<string, unknown>): ParsedMessage {
  const values: Record<string, number> = {};
  const rejected: ParsedMessage["rejected"] = [];
  const types = new Set<SensorType>();
  let alarm: number | null = null;
  for (const [key, val] of Object.entries(data)) {
    if (CONTROL_SET.has(key)) continue;
    if (key === ALARM_KEY) {
      if (typeof val === "number" && Number.isFinite(val)) alarm = val;
      continue;
    }
    const type = sensorTypeOf(key);
    if (!type) {
      rejected.push({ key, reason: "unknown-channel" });
      continue;
    }
    if (typeof val !== "number" || !Number.isFinite(val)) {
      rejected.push({ key, reason: "non-numeric" });
      continue;
    }
    values[key] = val;
    types.add(type);
  }
  const flag = (k: string) => data[k] === 1 || data[k] === true;
  return {
    values,
    alarm,
    control: { initialStart: flag("initialStart"), start: flag("start"), end: flag("end") },
    rejected,
    types: Array.from(types),
  };
}
