const mongoose = require("mongoose");

// An immutable, versioned snapshot of everything a device needs for offline campus
// navigation. Published explicitly (services/campusPackService.js); a new version is
// only created when the content checksum changes.
const campusPackSchema = new mongoose.Schema(
  {
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: "Campus", required: true },
    version: { type: Number, required: true, min: 1 },
    schemaVersion: { type: Number, required: true },
    checksum: { type: String, required: true }, // sha256 of the canonical snapshot JSON
    sizeBytes: { type: Number, required: true },
    // True when any record in the snapshot is DEV_FIXTURE data — clients can warn.
    containsDevFixture: { type: Boolean, default: false },
    snapshot: { type: Object, required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

campusPackSchema.index({ campusId: 1, version: -1 }, { unique: true });

module.exports = mongoose.model("CampusPack", campusPackSchema);
