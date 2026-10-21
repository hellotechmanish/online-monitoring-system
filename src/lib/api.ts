import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import mongoose from "mongoose";
import { getCurrentUser } from "./auth/session";
import { can, type Permission, type SessionUser } from "./auth/rbac";
import { getSettings } from "./settings";
import { logger, errInfo } from "./logger";
import { zodMessage } from "./validation";

const log = logger("api");

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(status: number, message: string, code?: string, details?: unknown) {
  return NextResponse.json(
    { error: { message, ...(code ? { code } : {}), ...(details ? { details } : {}) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Fallback when the server does not report the key (e.g. MongoDB-compatible servers): one unique business key per collection. */
const DUPLICATE_BY_COLLECTION: Record<string, string> = {
  sites: "Site code already exists",
  nodes: "Node ID already exists",
  users: "Username already exists",
};

const DUPLICATE_MESSAGES: Record<string, string> = {
  nodeId: "Node ID already exists",
  siteCode: "Site code already exists",
  username: "Username already exists",
  key: "Settings document already exists",
};

/** Maps any thrown error to a safe JSON response (no stack traces or internals). */
export function toErrorResponse(e: unknown) {
  if (e instanceof ApiError) return fail(e.status, e.message, e.code, e.details);
  if (e instanceof ZodError) {
    return fail(400, zodMessage(e), "VALIDATION_ERROR", e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const anyErr = e as { code?: number; keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown>; message?: string };
  if (anyErr?.code === 11000) {
    let field = Object.keys(anyErr.keyPattern ?? anyErr.keyValue ?? {})[0];
    if (!field) {
      const m = /index:\s*(\w+?)_\d/.exec(anyErr.message ?? "") ?? /dup key: \{ (\w+):/.exec(anyErr.message ?? "");
      field = m?.[1] ?? "";
    }
    const coll = /collection:\s*[^.\s]+\.(\w+)/.exec(anyErr.message ?? "")?.[1] ?? "";
    return fail(409, DUPLICATE_MESSAGES[field] ?? DUPLICATE_BY_COLLECTION[coll] ?? "Duplicate value", "DUPLICATE");
  }
  if (e instanceof mongoose.Error.ValidationError) {
    const first = Object.values(e.errors)[0];
    return fail(400, first?.message ?? "Validation failed", "VALIDATION_ERROR");
  }
  if (e instanceof mongoose.Error.CastError) return fail(400, `Invalid value for ${e.path}`, "VALIDATION_ERROR");
  log.error("Unhandled API error", errInfo(e));
  return fail(500, "Internal server error", "INTERNAL");
}

type Ctx = { params: Record<string, string> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<Response>;

export function route(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

/** Authenticated user (checked against DB on every call). Honors maintenance mode for non-admins. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Authentication required", "UNAUTHENTICATED");
  if (user.role !== "admin") {
    const s = await getSettings();
    if (s.maintenanceMode) throw new ApiError(503, "The system is under maintenance", "MAINTENANCE");
  }
  return user;
}

export function requirePermission(user: SessionUser, p: Permission, message?: string) {
  if (!can(user, p)) throw new ApiError(403, message ?? "You do not have permission to perform this action", "FORBIDDEN");
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 256 * 1024) throw new ApiError(413, "Request body too large");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON", "INVALID_JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.output<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export function assertObjectId(id: string, label = "ID"): void {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new ApiError(400, `Invalid ${label}`, "VALIDATION_ERROR");
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pagination(req: NextRequest, maxLimit = 100) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.get("page") ?? "1", 10) || 1));
  const limit = Math.max(1, Math.min(maxLimit, Number.parseInt(sp.get("limit") ?? "20", 10) || 20));
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  return { page, limit, skip: (page - 1) * limit, q };
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.ip ?? "local").trim();
}
