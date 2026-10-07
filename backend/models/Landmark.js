const mongoose = require("mongoose");
const searchKeysPlugin = require("./plugins/searchKeys");
const { provenanceFields } = require("../utils/provenance");
const { CAMPUS_CATEGORIES } = require("../utils/campusCategories");

const landmarkSchema = new mongoose.Schema(
  {
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: "Campus", required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: CAMPUS_CATEGORIES, default: "landmark" },
    description: { type: String, default: "", maxlength: 2000 },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    aliases: [{ type: String, trim: true, maxlength: 100 }],
    // Optional graph node, so landmarks can be route start/end points and appear in directions.
    navigationNodeId: { type: mongoose.Schema.Types.ObjectId, ref: "NavigationNode", default: null },
    isActive: { type: Boolean, default: true },
    ...provenanceFields,
  },
  { timestamps: true }
);

landmarkSchema.plugin(searchKeysPlugin, { fields: ["name"], arrayFields: ["aliases"] });

landmarkSchema.index({ campusId: 1, name: 1 }, { unique: true });
landmarkSchema.index({ campusId: 1, type: 1 });

landmarkSchema.plugin(require("./plugins/searchIndexInvalidation"));

module.exports = mongoose.model("Landmark", landmarkSchema);
