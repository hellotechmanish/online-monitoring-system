import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * One document per stored device message. `data` holds the original decoded
 * payload exactly as received (e.g. { RES_0: 4, alarm: 0, start: 1 }).
 * Site is resolved through Node.siteId, so no siteId is stored here.
 */
const SensorReadingSchema = new Schema(
  {
    nodeId: { type: Number, required: true },
    nodeRef: { type: Schema.Types.ObjectId, ref: "Node", required: true },
    data: {
      type: Schema.Types.Mixed,
      required: true,
      validate: {
        validator: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
        message: "data must be an object",
      },
    },
    receivedAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);
SensorReadingSchema.index({ nodeId: 1, receivedAt: -1 });
SensorReadingSchema.index({ nodeRef: 1, receivedAt: -1 });

export type SensorReadingDoc = InferSchemaType<typeof SensorReadingSchema>;
export const SensorReading: Model<InferSchemaType<typeof SensorReadingSchema>> =
  models.SensorReading || model("SensorReading", SensorReadingSchema);
