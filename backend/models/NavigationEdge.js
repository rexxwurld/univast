const mongoose = require("mongoose");
const { provenanceFields } = require("../utils/provenance");
const { EDGE_TYPES } = require("../utils/routingConstants");
const graphCacheInvalidation = require("./plugins/graphCacheInvalidation");

const navigationEdgeSchema = new mongoose.Schema(
  {
    campusId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campus",
      required: true,
    },
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NavigationNode",
      required: true,
    },
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NavigationNode",
      required: true,
    },
    // Walking distance in METERS.
    distance: { type: Number, required: true, min: 0 },
    bidirectional: { type: Boolean, default: true },
    // Walking metadata. All optional: edges created before Phase 5 behave as plain, unrestricted paths.
    type: { type: String, enum: EDGE_TYPES, default: "path" },
    // null = unknown (NOT "no"). Only an explicit false (or a stairs edge) is avoided by accessible-only routing.
    isAccessible: { type: Boolean, default: null },
    // true = closed / staff-only / not for pedestrians: never routed through.
    isRestricted: { type: Boolean, default: false },
    ...provenanceFields,
  },
  { timestamps: true }
);

navigationEdgeSchema.index({ campusId: 1 });
// Catches an exact duplicate (same campus, same from -> to) at the database
// level. The reverse-direction / bidirectional case is additionally checked
// in navigationEdgeController.js, since a unique index can't express "A->B
// bidirectional already covers B->A".
navigationEdgeSchema.index({ campusId: 1, from: 1, to: 1 }, { unique: true });

navigationEdgeSchema.plugin(graphCacheInvalidation);

module.exports = mongoose.model("NavigationEdge", navigationEdgeSchema);
