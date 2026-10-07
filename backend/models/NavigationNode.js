const mongoose = require("mongoose");
const { provenanceFields } = require("../utils/provenance");
const graphCacheInvalidation = require("./plugins/graphCacheInvalidation");

const NODE_TYPES = ["intersection", "poi", "entrance", "stairs", "elevator", "landmark"];

const navigationNodeSchema = new mongoose.Schema(
  {
    campusId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campus",
      required: true,
    },
    name: { type: String, default: "", trim: true },
    type: { type: String, enum: NODE_TYPES, default: "intersection" },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null,
    },
    // Optional indoor placement. Unused by outdoor routing today; present so stairs /
    // elevator / corridor nodes can be attached to a building floor later without a migration.
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "Building", default: null },
    floorId: { type: mongoose.Schema.Types.ObjectId, ref: "Floor", default: null },
    ...provenanceFields,
  },
  { timestamps: true }
);

navigationNodeSchema.index({ campusId: 1 });
navigationNodeSchema.index({ locationId: 1 });

navigationNodeSchema.statics.NODE_TYPES = NODE_TYPES;

navigationNodeSchema.plugin(graphCacheInvalidation);

module.exports = mongoose.model("NavigationNode", navigationNodeSchema);
