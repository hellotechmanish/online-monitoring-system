import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const SETTINGS_DEFAULTS = {
  projectTitle: "INDIAN AIRFORCE",
  projectSubtitle: "ONLINE RESISTANCE MONITORING SYSTEM",
  organizationName: "",
  logoUrl: "",
  faviconUrl: "",
  footerText: "",
  theme: "light" as "light" | "dark" | "system",
  timezone: "Asia/Kolkata",
  dateFormat: "DD-MM-YYYY" as "DD-MM-YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY",
  maintenanceMode: false,
  allowUserRegistration: false,
  databaseSaveIntervalSeconds: 5,
  liveChart: { enabled: true, maxPoints: 20, reconnectIntervalSeconds: 3 },
};

const positiveInt = { validator: (n: number) => Number.isInteger(n) && n > 0, message: "Must be a positive integer" };

const GlobalSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, immutable: true, default: "global" },
    projectTitle: { type: String, default: SETTINGS_DEFAULTS.projectTitle, maxlength: 120 },
    projectSubtitle: { type: String, default: SETTINGS_DEFAULTS.projectSubtitle, maxlength: 200 },
    organizationName: { type: String, default: "", maxlength: 200 },
    logoUrl: { type: String, default: "", maxlength: 500 },
    faviconUrl: { type: String, default: "", maxlength: 500 },
    footerText: { type: String, default: "", maxlength: 300 },
    theme: { type: String, enum: ["light", "dark", "system"], default: "light" },
    timezone: { type: String, default: "Asia/Kolkata" },
    dateFormat: { type: String, enum: ["DD-MM-YYYY", "YYYY-MM-DD", "MM/DD/YYYY"], default: "DD-MM-YYYY" },
    maintenanceMode: { type: Boolean, default: false },
    allowUserRegistration: { type: Boolean, default: false },
    databaseSaveIntervalSeconds: { type: Number, default: 5, validate: positiveInt },
    liveChart: {
      enabled: { type: Boolean, default: true },
      maxPoints: { type: Number, default: 20, validate: positiveInt },
      reconnectIntervalSeconds: { type: Number, default: 3, validate: positiveInt },
    },
  },
  { timestamps: true },
);

export type GlobalSettingDoc = InferSchemaType<typeof GlobalSettingSchema>;
export const GlobalSetting: Model<InferSchemaType<typeof GlobalSettingSchema>> =
  models.GlobalSetting || model("GlobalSetting", GlobalSettingSchema);
