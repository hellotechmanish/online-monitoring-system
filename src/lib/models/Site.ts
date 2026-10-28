import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type Model,
} from "mongoose";

const SiteSchema = new Schema(
  {
    siteCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 32,
    },
    siteName: { type: String, required: true, trim: true, maxlength: 120 },
    location: { type: String, trim: true, default: "", maxlength: 200 },
    description: { type: String, trim: true, default: "", maxlength: 1000 },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);
SiteSchema.index({ siteName: 1 });

export type SiteDoc = InferSchemaType<typeof SiteSchema> & {
  _id: import("mongoose").Types.ObjectId;
};
export const Site: Model<InferSchemaType<typeof SiteSchema>> =
  models.Site || model("Site", SiteSchema);
