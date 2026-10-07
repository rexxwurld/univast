const mongoose = require("mongoose");

const STATUS = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED"];
const TARGET_MODELS = ["Building", "Floor", "Room", "Entrance", "Landmark"];

const reviewHistorySchema = new mongoose.Schema(
  {
    action: { type: String, enum: ["SUBMITTED", "REVIEWED", "APPROVED", "REJECTED", "CHANGES_REQUESTED"], required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, default: Date.now },
    notes: { type: String, maxlength: 4000, default: "" },
    previousStatus: { type: String, enum: STATUS },
    nextStatus: { type: String, enum: STATUS },
  },
  { _id: false }
);

const contributionSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 200, required: true },
    description: { type: String, trim: true, maxlength: 5000, default: "" },
    submitterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: "Campus", required: true, index: true },
    targetModel: { type: String, enum: TARGET_MODELS, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, enum: STATUS, default: "DRAFT", index: true },
    proposedChanges: { type: mongoose.Schema.Types.Mixed, default: {} },
    evidenceFileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "UploadedFile" }],
    reason: { type: String, maxlength: 5000, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNotes: { type: String, maxlength: 5000, default: "" },
    history: { type: [reviewHistorySchema], default: [] },
    rewardPoints: { type: Number, min: 0, default: 0 },
    rewardGrantedAt: { type: Date, default: null },
    duplicateKey: { type: String, maxlength: 64, index: true },
    source: { type: String, enum: ["community", "campus_coordinator"], default: "community" },
  },
  { timestamps: true }
);

contributionSchema.index({ campusId: 1, targetModel: 1, targetId: 1, submitterId: 1, status: 1 });
contributionSchema.index({ submitterId: 1, status: 1, createdAt: -1 });
contributionSchema.index({ title: "text", description: "text" });
contributionSchema.statics.STATUSES = STATUS;
contributionSchema.statics.TARGET_MODELS = TARGET_MODELS;

module.exports = mongoose.model("Contribution", contributionSchema);
