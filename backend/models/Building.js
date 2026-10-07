const mongoose = require("mongoose");
const searchKeysPlugin = require("./plugins/searchKeys");
const { provenanceFields } = require("../utils/provenance");
const { CAMPUS_CATEGORIES } = require("../utils/campusCategories");
const { validateRing } = require("../utils/geofence");

const buildingSchema = new mongoose.Schema(
  {
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: "Campus", required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    abbreviation: { type: String, trim: true, default: "", maxlength: 30 },
    type: { type: String, enum: CAMPUS_CATEGORIES, default: "other" },
    description: { type: String, default: "", maxlength: 2000 },
    // Marker position.
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    // Optional footprint (GeoJSON Polygon, [lng,lat]). Never auto-derived from a PDF.
    footprint: {
      type: { type: String, enum: ["Polygon"] },
      coordinates: { type: [[[Number]]], default: undefined },
    },
    aliases: [{ type: String, trim: true, maxlength: 100 }],
    isActive: { type: Boolean, default: true },
    ...provenanceFields,
  },
  { timestamps: true }
);

buildingSchema.plugin(searchKeysPlugin, { fields: ["name", "abbreviation"], arrayFields: ["aliases"] });

buildingSchema.pre("validate", async function checkFootprint() {
  const fp = this.footprint;
  if (fp && fp.coordinates && fp.coordinates.length) {
    fp.type = "Polygon";
    const problems = validateRing(fp.coordinates[0]);
    if (problems.length) this.invalidate("footprint", problems.join("; "));
  }
});

buildingSchema.index({ campusId: 1, name: 1 }, { unique: true });
buildingSchema.index({ campusId: 1, type: 1 });

buildingSchema.plugin(require("./plugins/searchIndexInvalidation"));

module.exports = mongoose.model("Building", buildingSchema);
