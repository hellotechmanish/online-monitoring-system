/**
 * Publishes protocol-format test messages for ONE registered Node to MQTT_URL / MQTT_TOPIC.
 * The values are clearly synthetic test inputs for verifying the pipeline — not real readings.
 *
 *   npx tsx scripts/publish-sample.ts --node 1001 [--count 10] [--interval 1000]
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);
import mqtt from "mqtt";

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const nodeId = Number(arg("node"));
const count = Number(arg("count", "10"));
const interval = Number(arg("interval", "1000"));
const url = process.env.MQTT_URL;
const topic = process.env.MQTT_TOPIC || "b25saW5lcmVzbW9uaXRvcg==";
if (!url || !Number.isInteger(nodeId) || nodeId <= 0) {
  console.error("Usage: MQTT_URL must be set; pass --node <registered nodeId>");
  process.exit(1);
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const send = (c: mqtt.MqttClient, data: Record<string, unknown>) =>
  c.publishAsync(topic, JSON.stringify({ Node_Id: nodeId, data: b64(data) }), {
    qos: 1,
  });

const client = mqtt.connect(url, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
});
client.on("connect", async () => {
  console.log(`Publishing ${count} test cycles for Node ${nodeId} to ${topic}`);
  for (let i = 0; i < count; i++) {
    const j = (k: number) => Math.round((Math.sin(i / 3 + k) + 1) * 100) / 100; // deterministic test wave
    await send(client, { initialStart: 1 });
    await send(client, { RES_0: 3 + j(0), alarm: 0, start: 1 });
    await send(client, { RES_1: j(1), alarm: 0, start: 1 });
    await send(client, { NER_0: 0.5 + j(2) / 4, alarm: 0, start: 1 });
    await send(client, { NER_1: 0.6 + j(3) / 4, alarm: 0, start: 1 });
    await send(client, {
      VMR_R: 220 + Math.round(j(4) * 5),
      VMR_Y: 212,
      VMR_B: 210,
      start: 1,
    });
    await send(client, { SPD_R: 1470, SPD_Y: 1544, SPD_B: 1494, start: 1 });
    await send(client, { Temp: 30 + j(5), Hum: 55 + j(6), start: 1 });
    await send(client, { end: 1 });
    await new Promise((r) => setTimeout(r, interval));
  }
  client.end();
});
client.on("error", (e) => {
  console.error("MQTT error:", e.message);
  process.exit(1);
});
