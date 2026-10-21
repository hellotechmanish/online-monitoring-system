import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { ROLES, USERNAME_RE } from "../validation";

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Login identifier: unique, normalized to lowercase. */
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 32,
      match: [USERNAME_RE, "Invalid username"],
    },
    /** Legacy/optional contact field. Not used for login. */
    email: { type: String, trim: true, lowercase: true, default: undefined },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: "user", index: true },
    assignedSites: [{ type: Schema.Types.ObjectId, ref: "Site" }],
    isActive: { type: Boolean, default: true },
    /** Incremented to invalidate all existing sessions (password change, deactivation). */
    sessionVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

UserSchema.set("toJSON", {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: import("mongoose").Types.ObjectId };
export const User: Model<InferSchemaType<typeof UserSchema>> = models.User || model("User", UserSchema);
