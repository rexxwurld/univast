const mongoose = require("mongoose");

const VERIFICATION_STATUSES = ["pending", "verified", "rejected"];

const businessSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    // Real verification (document upload, manual review, etc.) is an admin-
    // tooling concern (Phase 6). For now this just tracks status so the
    // field exists and claim/place logic has something to read later.
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: "pending" },
  },
  { timestamps: true }
);

businessSchema.index({ owner: 1 });
businessSchema.statics.VERIFICATION_STATUSES = VERIFICATION_STATUSES;

module.exports = mongoose.model("Business", businessSchema);
