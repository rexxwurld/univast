const mongoose = require("mongoose");

const TARGET_TYPES = ["Place", "Review", "Business"];
const STATUSES = ["pending", "resolved", "dismissed"];

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Generic target via refPath rather than three separate report models —
    // reporting a new entity type later (e.g. a future "Event") just means
    // adding its name to TARGET_TYPES, not a new collection/controller.
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "targetType",
    },

    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: STATUSES, default: "pending" },

    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });

reportSchema.statics.TARGET_TYPES = TARGET_TYPES;
reportSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("Report", reportSchema);
