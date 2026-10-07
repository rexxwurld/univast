const mongoose = require("mongoose");

// A file received from a user. It is NOT trusted application data: it stays
// "quarantined" until a moderator decides otherwise, and the bytes live outside
// any web root under a random name with no extension (see middleware/secureUpload.js).
const STATUSES = ["quarantined", "approved", "rejected", "deleted"];

const uploadedFileSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    storageKey: { type: String, required: true, unique: true }, // random hex; never user-controlled
    originalName: { type: String, required: true }, // sanitized, display only
    sniffedMime: { type: String, required: true }, // from magic bytes, not from the client
    kind: { type: String, enum: ["image", "document", "video"], required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true }, // duplicate detection / anti-farming
    status: { type: String, enum: STATUSES, default: "quarantined" },
    // Filled in by the contribution system in a later phase.
    contributionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

uploadedFileSchema.index({ ownerId: 1, createdAt: -1 });
uploadedFileSchema.index({ sha256: 1 });
uploadedFileSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("UploadedFile", uploadedFileSchema);
