const mongoose = require("mongoose");
const { provenanceFields } = require("../utils/provenance");

const ENTRANCE_TYPES = ["main", "secondary", "service", "emergency"];

const entranceSchema = new mongoose.Schema(
  {
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: "Campus", required: true },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ENTRANCE_TYPES, default: "main" },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    // The walking-graph node that represents this door. Outdoor routes END here.
    // Null = the entrance is not yet connected to the path network (the router will
    // refuse to route to it rather than guess).
    navigationNodeId: { type: mongoose.Schema.Types.ObjectId, ref: "NavigationNode", default: null },
    isAccessible: { type: Boolean, default: null }, // null = unknown, not "no"
    ...provenanceFields,
  },
  { timestamps: true }
);

entranceSchema.index({ buildingId: 1 });
entranceSchema.index({ campusId: 1 });
entranceSchema.statics.ENTRANCE_TYPES = ENTRANCE_TYPES;

module.exports = mongoose.model("Entrance", entranceSchema);
