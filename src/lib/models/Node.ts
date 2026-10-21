import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { SENSOR_TYPES } from "../protocol/sensors";

const ThresholdSchema = new Schema(
  { low: { type: Number, default: null }, high: { type: Number, default: null } },
  { _id: false },
);

const OverrideSchema = new Schema(
  {
    sensorId: { type: String, required: true, maxlength: 32 },
    low: { type: Number, default: null },
    high: { type: Number, default: null },
  },
  { _id: false },
);

const SensorConfigSchema = new Schema(
  {
    sensorType: { type: String, enum: SENSOR_TYPES, required: true },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Sensor quantity must be greater than zero"],
      validate: { validator: Number.isInteger, message: "Sensor quantity must be a whole number" },
    },
    thresholds: { type: ThresholdSchema, default: () => ({}) },
    overrides: { type: [OverrideSchema], default: [] },
  },
  { _id: false },
);

/** Channel IDs actually observed in device messages (never derived from configured quantity). */
const DiscoveredSensorSchema = new Schema(
  {
    sensorId: { type: String, required: true, maxlength: 32 },
    sensorType: { type: String, required: true },
    firstSeenAt: { type: Date, required: true },
  },
  { _id: false },
);

// NOTE: Node intentionally has no IP address field.
const NodeSchema = new Schema(
  {
    nodeId: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
      validate: { validator: Number.isInteger, message: "Node ID must be a whole number" },
    },
    nodeName: { type: String, required: true, trim: true, maxlength: 120 },
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true, index: true },
    sensors: { type: [SensorConfigSchema], default: [] },
    status: { type: String, enum: ["online", "offline"], default: "offline" },
    discoveredSensors: { type: [DiscoveredSensorSchema], default: [] },
    lastReadingAt: { type: Date, default: null },
  },
  { timestamps: true },
);
NodeSchema.index({ nodeName: 1 });

export type NodeDoc = InferSchemaType<typeof NodeSchema> & { _id: import("mongoose").Types.ObjectId };
export const Node: Model<InferSchemaType<typeof NodeSchema>> = models.Node || model("Node", NodeSchema);
