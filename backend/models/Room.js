const mongoose = require("mongoose");
const searchKeysPlugin = require("./plugins/searchKeys");
const { provenanceFields } = require("../utils/provenance");
const { ROOM_TYPES } = require("../utils/campusCategories");

const roomSchema = new mongoose.Schema(
  {
    // campusId / buildingId are denormalized from the floor (controllers enforce consistency).
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: "Campus", required: true },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true },
    floorId: { type: mongoose.Schema.Types.ObjectId, ref: "Floor", required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    roomNumber: { type: String, trim: true, default: "", maxlength: 30 },
    type: { type: String, enum: ROOM_TYPES, default: "other" },
    description: { type: String, default: "", maxlength: 2000 },
    capacity: { type: Number, min: 0, default: null },
    aliases: [{ type: String, trim: true, maxlength: 100 }],
    // Optional INDOOR graph node for this room. When set, routes to the room must reach it (outdoor path,
    // then indoor edges incl. stairs/ramps/elevators). When null, routes end at the building entrance and the
    // room is described ("LT1 is on the Ground Floor"); no indoor corridors are ever invented.
    navigationNodeId: { type: mongoose.Schema.Types.ObjectId, ref: "NavigationNode", default: null },
    isActive: { type: Boolean, default: true },
    ...provenanceFields,
  },
  { timestamps: true }
);

roomSchema.plugin(searchKeysPlugin, { fields: ["name", "roomNumber"], arrayFields: ["aliases"] });

roomSchema.index({ floorId: 1, name: 1 }, { unique: true });
roomSchema.index({ campusId: 1, type: 1 });
roomSchema.index({ buildingId: 1 });

roomSchema.plugin(require("./plugins/searchIndexInvalidation"));

module.exports = mongoose.model("Room", roomSchema);
