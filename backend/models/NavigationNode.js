const mongoose = require("mongoose");

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
  },
  { timestamps: true }
);

navigationNodeSchema.index({ campusId: 1 });
navigationNodeSchema.index({ locationId: 1 });

navigationNodeSchema.statics.NODE_TYPES = NODE_TYPES;

module.exports = mongoose.model("NavigationNode", navigationNodeSchema);
