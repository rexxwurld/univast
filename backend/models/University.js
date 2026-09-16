const mongoose = require("mongoose");

const universitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ShortName: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

universitySchema.index({ name: 1 });
universitySchema.index({ ShortName: 1 });

module.exports = mongoose.model("University", universitySchema);
