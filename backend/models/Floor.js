const mongoose = require("mongoose");
const { provenanceFields } = require("../utils/provenance");

const floorSchema = new mongoose.Schema(
  {
    // campusId is denormalized (always equals the building's campus) so campus-wide
    // queries and offline packs don't need a join. Controllers enforce consistency.
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: "Campus", required: true },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true },
    floorNumber: { type: Number, required: true, validate: { validator: Number.isInteger, message: "floorNumber must be an integer (0 = ground, negative = basement)" } },
    name: { type: String, trim: true, default: "", maxlength: 100 },
    ...provenanceFields,
  },
  { timestamps: true }
);

floorSchema.index({ buildingId: 1, floorNumber: 1 }, { unique: true });
floorSchema.index({ campusId: 1 });

module.exports = mongoose.model("Floor", floorSchema);
