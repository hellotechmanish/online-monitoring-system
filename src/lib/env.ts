/** Server-only environment access. Never import from client components. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required environment variable ${name}`);
  return v.trim();
}

export function getAuthSecret(): Uint8Array {
  const s = requireEnv("AUTH_SECRET");
  if (s.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return new TextEncoder().encode(s);
}

export const isProd = process.env.NODE_ENV === "production";
