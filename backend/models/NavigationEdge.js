const mongoose = require("mongoose");

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
    distance: { type: Number, required: true, min: 0 },
    bidirectional: { type: Boolean, default: true },
  },
  { timestamps: true }
);

navigationEdgeSchema.index({ campusId: 1 });
// Catches an exact duplicate (same campus, same from -> to) at the database
// level. The reverse-direction / bidirectional case is additionally checked
// in navigationEdgeController.js, since a unique index can't express "A->B
// bidirectional already covers B->A".
navigationEdgeSchema.index({ campusId: 1, from: 1, to: 1 }, { unique: true });

module.exports = mongoose.model("NavigationEdge", navigationEdgeSchema);
