import mongoose from "mongoose";
import { requireEnv } from "./env";
import { logger, errInfo } from "./logger";

const log = logger("db");

interface Cache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  bootstrapped: Promise<void> | null;
}

// Reuse a single connection across Next.js hot reloads and module re-imports.
const g = globalThis as unknown as { __dermsMongo?: Cache };
const cache: Cache = g.__dermsMongo ?? (g.__dermsMongo = { conn: null, promise: null, bootstrapped: null });

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;
  if (!cache.promise) {
    const uri = requireEnv("MONGODB_URI");
    mongoose.set("strictQuery", true);
    cache.promise = mongoose
      .connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 8000, maxPoolSize: 10 })
      .then((m) => {
        log.info("MongoDB connected");
        return m;
      })
      .catch((e) => {
        cache.promise = null;
        log.error("MongoDB connection failed", errInfo(e));
        throw e;
      });
  }
  cache.conn = await cache.promise;
  if (!cache.bootstrapped) {
    // Lazy import avoids a circular dependency (bootstrap imports models).
    cache.bootstrapped = import("./bootstrap")
      .then((m) => m.runBootstrap())
      .catch((e) => {
        cache.bootstrapped = null;
        log.error("Bootstrap failed", errInfo(e));
      });
  }
  await cache.bootstrapped;
  return cache.conn;
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
  cache.bootstrapped = null;
}
