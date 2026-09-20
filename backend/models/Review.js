const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    place: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Place",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, default: "", trim: true },
    photos: [{ type: String, trim: true }],

    // Moderation flag for Phase 6 (admin/reports) — hidden reviews stay in the
    // DB (so a moderator can review the decision) but are excluded from
    // public listing and from the place's rating aggregate.
    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One review per user per place. Also the query the app runs most often
// (all reviews for a place), so it doubles as that lookup index too.
reviewSchema.index({ place: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Review", reviewSchema);
