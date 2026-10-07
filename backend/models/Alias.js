const mongoose = require("mongoose");

const ALIAS_TYPES = ["abbreviation", "common_name", "student_slang", "former_name", "alias"];
const ALIAS_SOURCES = ["OFFICIAL", "SURVEY", "COORDINATOR", "COMMUNITY", "IMPORTED", "DEV_FIXTURE"];

const aliasSchema = new mongoose.Schema(
  {
    targetModel: {
      type: String,
      required: true,
      enum: ["University", "Campus", "Building", "Floor", "Room", "Landmark", "Entrance", "Place"],
    },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    value: { type: String, required: true, trim: true, maxlength: 200 },
    normalized: { type: String, required: true, lowercase: true },
    type: { type: String, enum: ALIAS_TYPES, default: "alias" },
    source: { type: String, enum: ALIAS_SOURCES, default: "OFFICIAL" },
    verified: { type: Boolean, default: false },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

aliasSchema.pre("validate", function normalizeAlias() {
  if (!this.value) return;
  this.normalized = this.value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
});

aliasSchema.index({ targetModel: 1, targetId: 1, normalized: 1 }, { unique: true });
aliasSchema.index({ targetModel: 1, normalized: 1 });
aliasSchema.index({ targetModel: 1, targetId: 1 });

aliasSchema.statics.ALIAS_TYPES = ALIAS_TYPES;
aliasSchema.statics.ALIAS_SOURCES = ALIAS_SOURCES;

aliasSchema.plugin(require("./plugins/searchIndexInvalidation"));

module.exports = mongoose.model("Alias", aliasSchema);
