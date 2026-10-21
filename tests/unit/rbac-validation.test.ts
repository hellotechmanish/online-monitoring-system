import { describe, it, expect } from "vitest";
import { can, canAccessSite, canManageAccount, creatableRoles, nodeScopeFilter, siteScopeFilter, type SessionUser } from "@/lib/auth/rbac";
import { nodeCreateSchema, nodeUpdateSchema, userCreateSchema, username, settingsUpdateSchema, historyQuerySchema, loginSchema } from "@/lib/validation";

const S1 = "1".repeat(24);
const S2 = "2".repeat(24);
const admin: SessionUser = { id: "a", name: "A", username: "admin", role: "admin", assignedSites: [] };
const tech: SessionUser = { id: "t", name: "T", username: "tech", role: "technician", assignedSites: [] };
const user: SessionUser = { id: "u", name: "U", username: "user", role: "user", assignedSites: [S1] };

describe("RBAC", () => {
  it("permission matrix", () => {
    expect(can(admin, "sites:manage")).toBe(true);
    expect(can(admin, "nodes:manage")).toBe(true);
    expect(can(admin, "settings:manage")).toBe(true);
    expect(can(tech, "sites:manage")).toBe(false);
    expect(can(tech, "nodes:manage")).toBe(false);
    expect(can(tech, "settings:manage")).toBe(false);
    expect(can(tech, "users:create")).toBe(true);
    expect(can(tech, "users:assign_sites")).toBe(true);
    expect(can(user, "users:view")).toBe(false);
    expect(can(user, "monitoring:view")).toBe(true);
    expect(can(null, "monitoring:view")).toBe(false);
  });
  it("site scoping", () => {
    expect(canAccessSite(user, S1)).toBe(true);
    expect(canAccessSite(user, S2)).toBe(false);
    expect(canAccessSite(tech, S2)).toBe(true);
    expect(siteScopeFilter(user)).toEqual({ _id: { $in: [S1] } });
    expect(nodeScopeFilter(user)).toEqual({ siteId: { $in: [S1] } });
    expect(siteScopeFilter(admin)).toEqual({});
  });
  it("role creation and account management never allows admin escalation", () => {
    expect(creatableRoles(admin)).toEqual(["technician", "user"]);
    expect(creatableRoles(tech)).toEqual(["user"]);
    expect(creatableRoles(user)).toEqual([]);
    expect(canManageAccount(tech, "technician", "x")).toBe(false);
    expect(canManageAccount(tech, "user", "x")).toBe(true);
    expect(canManageAccount(admin, "admin", "x")).toBe(false);
    expect(canManageAccount(admin, "user", "a")).toBe(false); // not self
  });
});

describe("validation", () => {
  const base = { nodeId: "1001", nodeName: "EQ", siteId: S1 };
  it("creates a valid Node payload with multiple sensor configs", () => {
    const r = nodeCreateSchema.parse({
      ...base,
      sensors: [
        { sensorType: "RES", quantity: "2", thresholds: { low: "0.01", high: "10" } },
        { sensorType: "VMR", quantity: 3 },
        { sensorType: "TEMP", quantity: 1, thresholds: { low: "", high: "" } },
      ],
    });
    expect(r.nodeId).toBe(1001);
    expect(r.sensors[0]).toMatchObject({ quantity: 2, thresholds: { low: 0.01, high: 10 } });
    expect(r.sensors[2].thresholds).toEqual({ low: null, high: null });
  });
  it.each([
    [{ ...base, siteId: "" }, "Please select a valid Site"],
    [{ ...base, siteId: "nope" }, "Invalid ID"],
    [{ ...base, sensors: [{ sensorType: "RES", quantity: 0 }] }, "Sensor quantity must be greater than zero"],
    [{ ...base, sensors: [{ sensorType: "RES", quantity: 1.5 }] }, "Sensor quantity must be a whole number"],
    [{ ...base, sensors: [{ sensorType: "XYZ", quantity: 1 }] }, "Select a valid sensor type"],
    [{ ...base, sensors: [{ sensorType: "RES", quantity: 1, thresholds: { low: 5, high: 1 } }] }, "Low threshold must be less than or equal to high threshold"],
    [{ ...base, sensors: [{ sensorType: "RES", quantity: 1 }, { sensorType: "RES", quantity: 2 }] }, "Each sensor type can only be configured once per Node"],
    [{ ...base, sensors: [{ sensorType: "RES", quantity: 1, overrides: [{ sensorId: "NER_0", high: 1 }] }] }, "Override NER_0 is not a RES channel"],
    [{ ...base, nodeId: "-3" }, "Node ID must be a positive number"],
  ])("rejects invalid Node input %#", (input, message) => {
    const r = nodeCreateSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain(message);
  });
  it("Node ID is immutable and IP addresses are not accepted on update", () => {
    expect(nodeUpdateSchema.safeParse({ nodeId: 5 }).success).toBe(false);
    expect(nodeUpdateSchema.safeParse({ ipAddress: "10.0.0.1" }).success).toBe(false);
    expect(nodeUpdateSchema.safeParse({ nodeName: "EQ-2" }).success).toBe(true);
  });
  it("usernames are normalized and validated", () => {
    expect(username.parse("  Operator.One ")).toBe("operator.one");
    expect(username.safeParse("ab").success).toBe(false);
    expect(username.safeParse("bad name").success).toBe(false);
    expect(username.safeParse("user@example.com").success).toBe(false);
    expect(loginSchema.parse({ username: "ADMIN", password: "x" }).username).toBe("admin");
  });
  it("user creation cannot request the admin role", () => {
    const r = userCreateSchema.safeParse({ name: "X", username: "xx1", password: "password1", role: "admin" });
    expect(r.success).toBe(false);
  });
  it("settings validation", () => {
    expect(settingsUpdateSchema.safeParse({ databaseSaveIntervalSeconds: 0 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ liveChart: { maxPoints: 20 } }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ unknownField: 1 }).success).toBe(false);
  });
  it("history query validation", () => {
    expect(historyQuerySchema.parse({ nodeId: "1001", sensors: "RES_0, RES_1" })).toEqual({ nodeId: 1001, sensors: ["RES_0", "RES_1"], limit: 20 });
    expect(historyQuerySchema.safeParse({ nodeId: "1001", sensors: "data.$gt" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ nodeId: "1001", sensors: "RES_0", limit: "100000" }).success).toBe(false);
  });
});
