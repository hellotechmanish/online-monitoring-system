/**
 * Small in-memory fixed-window rate limiter (per process).
 * Adequate for a single-instance deployment; use a shared store (e.g. Redis)
 * when running multiple instances.
 */
const g = globalThis as unknown as { __dermsRate?: Map<string, { count: number; reset: number }> };
const buckets = g.__dermsRate ?? (g.__dermsRate = new Map());

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
