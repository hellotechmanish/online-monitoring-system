/** Minimal structured logger. Never pass secrets, password hashes or connection strings. */
type Level = "debug" | "info" | "warn" | "error";
function emit(level: Level, scope: string, msg: string, meta?: Record<string, unknown>) {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...(meta ?? {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
export function logger(scope: string) {
  return {
    debug: (m: string, meta?: Record<string, unknown>) => emit("debug", scope, m, meta),
    info: (m: string, meta?: Record<string, unknown>) => emit("info", scope, m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => emit("warn", scope, m, meta),
    error: (m: string, meta?: Record<string, unknown>) => emit("error", scope, m, meta),
  };
}
/** Safe error description: message only, never stack or connection details. */
export function errInfo(e: unknown): { error: string } {
  const msg = e instanceof Error ? e.message : String(e);
  return { error: msg.replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, "mongodb://<redacted>").slice(0, 300) };
}
