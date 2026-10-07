const mongoose = require("mongoose");

const rewardConfigSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120, required: true },
    targetModel: { type: String, trim: true, maxlength: 80, required: true },
    points: { type: Number, min: 0, required: true },
    isActive: { type: Boolean, default: true },
    description: { type: String, maxlength: 500, default: "" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

rewardConfigSchema.index({ targetModel: 1, isActive: 1, points: -1 });

module.exports = mongoose.model("ContributionRewardConfig", rewardConfigSchema);
