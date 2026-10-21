"use client";

export class ApiClientError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: Array<{ path: string; message: string }>) {
    super(message);
  }
}

/** JSON fetch helper for browser components. Redirects to sign-in on expired sessions. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiClientError(0, "Network error. Check your connection and try again.");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string; details?: Array<{ path: string; message: string }> } })?.error;
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) {
      window.location.href = `/login?expired=1&next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiClientError(res.status, err?.message ?? `Request failed (${res.status})`, err?.code, err?.details);
  }
  return json as T;
}

export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
