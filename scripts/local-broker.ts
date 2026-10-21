/**
 * Local MQTT broker for development and automated end-to-end tests (no hardware).
 *   npm run mqtt:local-broker            → mqtt://127.0.0.1:1883
 * Not for production: use your real broker (MQTT_URL).
 */
import net from "node:net";
import { createBroker } from "aedes";

export function startLocalBroker(port = Number(process.env.LOCAL_MQTT_PORT) || 1883) {
  const broker = createBroker();
  const server = net.createServer(broker.handle);
  return new Promise<{ close: () => Promise<void>; port: number }>((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        close: () =>
          new Promise<void>((r) => {
            broker.close(() => server.close(() => r()));
          }),
      });
    });
  });
}

if (process.argv[1]?.includes("local-broker")) {
  startLocalBroker().then(({ port }) => console.log(`Local MQTT broker listening on mqtt://127.0.0.1:${port}`));
}
