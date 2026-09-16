const mongoose = require("mongoose");

const campusSchema = new mongoose.Schema(
  {
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
  },
  { timestamps: true }
);

campusSchema.index({ universityId: 1 });
campusSchema.index({ name: 1 });

module.exports = mongoose.model("Campus", campusSchema);
