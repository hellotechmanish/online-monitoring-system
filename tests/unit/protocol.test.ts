import { describe, it, expect } from "vitest";
import { decodeEnvelope, parsePayload, DecodeError } from "@/lib/protocol/decode";
import { sensorTypeOf, sortSensorIds, classifyValue, resolveThresholds, colorForSensor } from "@/lib/protocol/sensors";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const env = (nodeId: unknown, data: unknown) => JSON.stringify({ Node_Id: nodeId, data });

describe("decodeEnvelope", () => {
  it("decodes a Base64 JSON payload", () => {
    const r = decodeEnvelope(env(1001, b64({ RES_0: 4, alarm: 0, start: 1 })));
    expect(r).toEqual({ nodeId: 1001, data: { RES_0: 4, alarm: 0, start: 1 } });
  });
  it("accepts numeric string Node_Id and buffers", () => {
    const r = decodeEnvelope(Buffer.from(env("1002", b64({ Temp: 31.8, Hum: 55.8, start: 1 }))));
    expect(r.nodeId).toBe(1002);
    expect(r.data).toEqual({ Temp: 31.8, Hum: 55.8, start: 1 });
  });
  it("accepts JSON object data in auto mode and rejects it in base64 mode", () => {
    expect(decodeEnvelope(env(1, { end: 1 })).data).toEqual({ end: 1 });
    expect(() => decodeEnvelope(env(1, { end: 1 }), "base64")).toThrow(DecodeError);
  });
  it("accepts a JSON string payload in json mode", () => {
    expect(decodeEnvelope(env(1, JSON.stringify({ initialStart: 1 })), "json").data).toEqual({ initialStart: 1 });
  });
  it.each([
    ["not json", "INVALID_JSON"],
    [JSON.stringify({ data: "x" }), "INVALID_ENVELOPE"],
    [JSON.stringify([1, 2]), "INVALID_ENVELOPE"],
    [env(-5, b64({})), "INVALID_NODE_ID"],
    [env(1.5, b64({})), "INVALID_NODE_ID"],
    [env("abc", b64({})), "INVALID_NODE_ID"],
    [env(1, "%%%notbase64"), "INVALID_BASE64"],
    [env(1, Buffer.from("not json").toString("base64")), "INVALID_PAYLOAD"],
    [env(1, b64([1, 2])), "INVALID_PAYLOAD"],
  ])("rejects malformed input %#", (raw, code) => {
    try {
      decodeEnvelope(raw as string, "auto");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DecodeError);
      expect((e as DecodeError).code).toBe(code);
    }
  });
  it("rejects oversized messages", () => {
    expect(() => decodeEnvelope(env(1, "A".repeat(20_000)))).toThrow(/too large/);
  });
});

describe("parsePayload", () => {
  it("treats control messages as non-readings", () => {
    for (const m of [{ initialStart: 1 }, { end: 1 }]) {
      const p = parsePayload(m);
      expect(p.values).toEqual({});
      expect(p.types).toEqual([]);
    }
    expect(parsePayload({ initialStart: 1 }).control.initialStart).toBe(true);
    expect(parsePayload({ end: 1 }).control.end).toBe(true);
  });
  it("separates alarm and start from sensor values", () => {
    const p = parsePayload({ RES_0: 4, alarm: 0, start: 1 });
    expect(p.values).toEqual({ RES_0: 4 });
    expect(p.alarm).toBe(0);
    expect(p.control.start).toBe(true);
  });
  it("keeps all keys of multi-sensor messages with exact IDs", () => {
    expect(parsePayload({ VMR_R: 224, VMR_Y: 212, VMR_B: 210, start: 1 }).values).toEqual({ VMR_R: 224, VMR_Y: 212, VMR_B: 210 });
    expect(parsePayload({ SPD_R: 1470, SPD_Y: 1544, SPD_B: 1494, start: 1 }).types).toEqual(["SPD"]);
    expect(parsePayload({ Temp: 31.8, Hum: 55.8, start: 1 }).values).toEqual({ Temp: 31.8, Hum: 55.8 });
    expect(parsePayload({ NER_1: 0.937, alarm: 0, start: 1 }).values).toEqual({ NER_1: 0.937 });
  });
  it("rejects non-numeric values and unknown channels without throwing", () => {
    const p = parsePayload({ RES_0: "4", NER_0: null, FOO: 1, GN_0: 3, RES_2: 7 });
    expect(p.values).toEqual({ RES_2: 7 });
    expect(p.rejected).toEqual(
      expect.arrayContaining([
        { key: "RES_0", reason: "non-numeric" },
        { key: "NER_0", reason: "non-numeric" },
        { key: "FOO", reason: "unknown-channel" },
        { key: "GN_0", reason: "unknown-channel" },
      ]),
    );
  });
  it("does not mutate the original payload", () => {
    const data = { RES_0: 4, alarm: 0, start: 1 };
    parsePayload(data);
    expect(data).toEqual({ RES_0: 4, alarm: 0, start: 1 });
  });
});

describe("sensor mapping and ordering", () => {
  it("maps exact channel IDs to types", () => {
    expect(sensorTypeOf("RES_0")).toBe("RES");
    expect(sensorTypeOf("RES_12")).toBe("RES");
    expect(sensorTypeOf("NER_1")).toBe("NER");
    expect(sensorTypeOf("VMR_R")).toBe("VMR");
    expect(sensorTypeOf("SPD_B")).toBe("SPD");
    expect(sensorTypeOf("Temp")).toBe("TEMP");
    expect(sensorTypeOf("Hum")).toBe("HUM");
    expect(sensorTypeOf("temp")).toBeNull();
    expect(sensorTypeOf("VMR_X")).toBeNull();
    expect(sensorTypeOf("start")).toBeNull();
    expect(sensorTypeOf("alarm")).toBeNull();
  });
  it("orders sensors stably by type then channel", () => {
    expect(sortSensorIds(["Hum", "VMR_B", "RES_1", "NER_0", "Temp", "SPD_R", "RES_0", "VMR_R", "RES_10", "VMR_Y", "RES_2"])).toEqual([
      "RES_0", "RES_1", "RES_2", "RES_10", "NER_0", "VMR_R", "VMR_Y", "VMR_B", "SPD_R", "Temp", "Hum",
    ]);
  });
  it("gives stable distinct colours", () => {
    expect(colorForSensor("RES_0")).toBe(colorForSensor("RES_0"));
    expect(colorForSensor("RES_0")).not.toBe(colorForSensor("RES_1"));
    expect(colorForSensor("RES_7")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("thresholds", () => {
  const cfg = [
    { sensorType: "RES" as const, quantity: 2, thresholds: { low: 0.01, high: 10 }, overrides: [{ sensorId: "RES_1", low: null, high: 5 }] },
    { sensorType: "VMR" as const, quantity: 3, thresholds: {} },
  ];
  it("uses type thresholds, sensor overrides and never invents limits", () => {
    expect(resolveThresholds("RES_0", cfg)).toEqual({ low: 0.01, high: 10 });
    expect(resolveThresholds("RES_1", cfg)).toEqual({ low: null, high: 5 });
    expect(resolveThresholds("VMR_R", cfg)).toBeNull();
    expect(resolveThresholds("Temp", cfg)).toBeNull();
  });
  it("classifies values", () => {
    expect(classifyValue(4, { low: 0.01, high: 10 })).toBe("normal");
    expect(classifyValue(0, { low: 0.01, high: 10 })).toBe("low");
    expect(classifyValue(11, { low: 0.01, high: 10 })).toBe("high");
    expect(classifyValue(6, { low: null, high: 5 })).toBe("high");
    expect(classifyValue(6, null)).toBe("unconfigured");
  });
});
