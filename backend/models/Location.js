const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema(
  {
    campusId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campus",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    aliases: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

locationSchema.index({ campusId: 1 });
locationSchema.index({ category: 1 });
locationSchema.index({ name: "text", aliases: "text" });

module.exports = mongoose.model("Location", locationSchema);
