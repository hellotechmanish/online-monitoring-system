import { z } from "zod";
import { SENSOR_ID_RE, SENSOR_TYPES, sensorTypeOf } from "./protocol/sensors";

export const ROLES = ["admin", "technician", "user"] as const;
export type Role = (typeof ROLES)[number];

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid ID");

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/;
export const username = z
  .string({ required_error: "Username is required" })
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(USERNAME_RE, "Username may contain lowercase letters, digits, dot, dash and underscore, and must start and end with a letter or digit");

export const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "Username is required").max(64),
  password: z.string().min(1, "Password is required").max(128),
});

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------
export const siteCreateSchema = z.object({
  siteCode: z
    .string()
    .trim()
    .min(1, "Site code is required")
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Site code may contain letters, digits, dash and underscore")
    .transform((s) => s.toUpperCase()),
  siteName: z.string().trim().min(1, "Site name is required").max(120),
  location: z.string().trim().max(200).optional().default(""),
  description: z.string().trim().max(1000).optional().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
});
export const siteUpdateSchema = siteCreateSchema.partial().strict();
export type SiteCreateInput = z.input<typeof siteCreateSchema>;

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------
const optionalNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Threshold must be a number" });
      return z.NEVER;
    }
    return n;
  });

const thresholdsSchema = z
  .object({ low: optionalNumber.optional(), high: optionalNumber.optional() })
  .default({})
  .transform((t) => ({ low: t.low ?? null, high: t.high ?? null }))
  .refine((t) => t.low === null || t.high === null || t.low <= t.high, {
    message: "Low threshold must be less than or equal to high threshold",
  });

const overrideSchema = z
  .object({
    sensorId: z.string().trim().regex(SENSOR_ID_RE, "Invalid sensor ID"),
    low: optionalNumber.optional(),
    high: optionalNumber.optional(),
  })
  .transform((o) => ({ sensorId: o.sensorId, low: o.low ?? null, high: o.high ?? null }))
  .refine((t) => t.low === null || t.high === null || t.low <= t.high, {
    message: "Override low threshold must be less than or equal to high threshold",
  });

export const sensorConfigSchema = z.object({
  sensorType: z.enum(SENSOR_TYPES, { errorMap: () => ({ message: "Select a valid sensor type" }) }),
  quantity: z.coerce
    .number({ invalid_type_error: "Sensor quantity must be a number" })
    .int("Sensor quantity must be a whole number")
    .positive("Sensor quantity must be greater than zero")
    .max(64, "Sensor quantity must be at most 64"),
  thresholds: thresholdsSchema,
  overrides: z.array(overrideSchema).max(64).default([]),
}).superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  cfg.overrides.forEach((o, i) => {
    if (sensorTypeOf(o.sensorId) !== cfg.sensorType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overrides", i, "sensorId"],
        message: `Override ${o.sensorId} is not a ${cfg.sensorType} channel`,
      });
    }
    if (seen.has(o.sensorId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["overrides", i, "sensorId"], message: `Duplicate override for ${o.sensorId}` });
    }
    seen.add(o.sensorId);
  });
});

const sensorsArray = z
  .array(sensorConfigSchema)
  .max(SENSOR_TYPES.length)
  .default([])
  .refine((arr) => new Set(arr.map((s) => s.sensorType)).size === arr.length, {
    message: "Each sensor type can only be configured once per Node",
  });

export const nodeCreateSchema = z.object({
  nodeId: z.coerce
    .number({ invalid_type_error: "Node ID must be a number" })
    .int("Node ID must be a whole number")
    .positive("Node ID must be a positive number")
    .max(999_999_999, "Node ID is too large"),
  nodeName: z.string().trim().min(1, "Node name is required").max(120),
  siteId: objectId.or(z.literal("")).refine((v) => v !== "", "Please select a valid Site"),
  sensors: sensorsArray,
});
/** nodeId is immutable; siteId may be changed by admins through the Nodes page. */
export const nodeUpdateSchema = z
  .object({
    nodeName: z.string().trim().min(1, "Node name is required").max(120),
    siteId: objectId,
    sensors: sensorsArray,
    status: z.enum(["online", "offline"]),
  })
  .partial()
  .strict();
export type NodeCreateInput = z.input<typeof nodeCreateSchema>;
export type SensorConfigInput = z.input<typeof sensorConfigSchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  username,
  password,
  role: z.enum(["technician", "user"], { errorMap: () => ({ message: "Role must be Technician or User" }) }),
  assignedSites: z.array(objectId).max(500).default([]),
  isActive: z.boolean().default(true),
});
export const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    username,
    role: z.enum(["technician", "user"]),
    isActive: z.boolean(),
    password,
  })
  .partial()
  .strict();
export const assignSitesSchema = z.object({ assignedSites: z.array(objectId).max(500) });

export const profileUpdateSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(120) }).strict();
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must be different",
    path: ["newPassword"],
  });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const urlOrEmpty = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || v.startsWith("/") || /^https?:\/\//i.test(v), "Must be an http(s) URL or a path starting with /");

export const TIMEZONES_HINT = ["Asia/Kolkata", "UTC"];
export const DATE_FORMATS = ["DD-MM-YYYY", "YYYY-MM-DD", "MM/DD/YYYY"] as const;

export const settingsUpdateSchema = z
  .object({
    projectTitle: z.string().trim().min(1).max(120),
    projectSubtitle: z.string().trim().max(200),
    organizationName: z.string().trim().max(200),
    logoUrl: urlOrEmpty,
    faviconUrl: urlOrEmpty,
    footerText: z.string().trim().max(300),
    theme: z.enum(["light", "dark", "system"]),
    timezone: z.string().trim().refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown IANA timezone"),
    dateFormat: z.enum(DATE_FORMATS),
    maintenanceMode: z.boolean(),
    allowUserRegistration: z.boolean(),
    databaseSaveIntervalSeconds: z.coerce.number().int().min(1, "Must be at least 1 second").max(3600),
    liveChart: z
      .object({
        enabled: z.boolean(),
        maxPoints: z.coerce.number().int().min(5).max(500),
        reconnectIntervalSeconds: z.coerce.number().int().min(1).max(300),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

// ---------------------------------------------------------------------------
// Readings & realtime
// ---------------------------------------------------------------------------
export const sensorList = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(SENSOR_ID_RE, "Invalid sensor ID")).min(1, "Select at least one sensor").max(24));

export const historyQuerySchema = z.object({
  nodeId: z.coerce.number().int().positive(),
  sensors: sensorList,
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

export const wsClientMessageSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("subscribe"),
    requestId: z.string().min(1).max(64),
    siteId: objectId,
    nodeId: z.number().int().positive(),
    sensors: z.array(z.string().regex(SENSOR_ID_RE)).min(1).max(24),
  }),
  z.object({ action: z.literal("unsubscribe"), nodeId: z.number().int().positive().optional() }),
  z.object({ action: z.literal("ping") }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

export function zodMessage(err: z.ZodError): string {
  const first = err.issues[0];
  return first?.message ?? "Invalid request";
}
