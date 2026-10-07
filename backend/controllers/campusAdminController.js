/**
 * Campus-data write endpoints (admin + campus_coordinator). Authorization is applied
 * in routes/v1/campusData.js with requireAuth + requireRole — never rely on the client.
 *
 * Every write goes through doc.save() (not updateOne) so validation and the
 * searchKeys hook always run, then flags the campus as having unpublished pack changes.
 */
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Entrance = require("../models/Entrance");
const Landmark = require("../models/Landmark");
const NavigationNode = require("../models/NavigationNode");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { publishPack, markCampusDirty } = require("../services/campusPackService");

async function requireBuilding(buildingId, campusId) {
  const building = await Building.findOne({ _id: buildingId, campusId });
  if (!building) throw new ApiError(400, `buildingId '${buildingId}' does not reference a building on this campus`);
  return building;
}

async function requireFloor(floorId, campusId) {
  const floor = await Floor.findOne({ _id: floorId, campusId });
  if (!floor) throw new ApiError(400, `floorId '${floorId}' does not reference a floor on this campus`);
  return floor;
}

async function requireNode(nodeId, campusId) {
  if (!nodeId) return;
  const node = await NavigationNode.findOne({ _id: nodeId, campusId });
  if (!node) throw new ApiError(400, `navigationNodeId '${nodeId}' does not reference a navigation node on this campus`);
}

/** Per-resource rules. `prepare` returns extra fields to store and may throw ApiError. */
const RESOURCES = {
  building: {
    Model: Building,
    label: "Building",
    prepareCreate: async () => ({}),
    prepareUpdate: async () => ({}),
    async guardDelete(doc) {
      const [floors, rooms, entrances] = await Promise.all([
        Floor.countDocuments({ buildingId: doc._id }),
        Room.countDocuments({ buildingId: doc._id }),
        Entrance.countDocuments({ buildingId: doc._id }),
      ]);
      if (floors || rooms || entrances) {
        throw new ApiError(409, `Building still has ${floors} floor(s), ${rooms} room(s) and ${entrances} entrance(s). Delete those first.`);
      }
    },
  },
  floor: {
    Model: Floor,
    label: "Floor",
    async prepareCreate(body, campusId) {
      await requireBuilding(body.buildingId, campusId);
      return {};
    },
    prepareUpdate: async () => ({}),
    async guardDelete(doc) {
      const rooms = await Room.countDocuments({ floorId: doc._id });
      if (rooms) throw new ApiError(409, `Floor still has ${rooms} room(s). Delete or move them first.`);
    },
  },
  room: {
    Model: Room,
    label: "Room",
    async prepareCreate(body, campusId) {
      const floor = await requireFloor(body.floorId, campusId);
      await requireNode(body.navigationNodeId, campusId);
      return { buildingId: floor.buildingId };
    },
    async prepareUpdate(body, campusId) {
      await requireNode(body.navigationNodeId, campusId);
      if (!body.floorId) return {};
      const floor = await requireFloor(body.floorId, campusId);
      return { buildingId: floor.buildingId };
    },
  },
  entrance: {
    Model: Entrance,
    label: "Entrance",
    async prepareCreate(body, campusId) {
      await requireBuilding(body.buildingId, campusId);
      await requireNode(body.navigationNodeId, campusId);
      return {};
    },
    async prepareUpdate(body, campusId) {
      await requireNode(body.navigationNodeId, campusId);
      return {};
    },
  },
  landmark: {
    Model: Landmark,
    label: "Landmark",
    async prepareCreate(body, campusId) {
      await requireNode(body.navigationNodeId, campusId);
      return {};
    },
    async prepareUpdate(body, campusId) {
      await requireNode(body.navigationNodeId, campusId);
      return {};
    },
  },
};

function crud(name) {
  const r = RESOURCES[name];

  const create = asyncHandler(async (req, res) => {
    const campusId = req.campus._id;
    const extra = await r.prepareCreate(req.body, campusId);
    // dataSource is assigned here, never taken from the client.
    const doc = await r.Model.create({ ...req.body, ...extra, campusId, dataSource: "manual" });
    await markCampusDirty(campusId);
    res.status(201).json(doc);
  });

  const update = asyncHandler(async (req, res) => {
    const campusId = req.campus._id;
    const doc = await r.Model.findOne({ _id: req.params.id, campusId });
    if (!doc) throw new ApiError(404, `${r.label} not found`);
    const extra = await r.prepareUpdate(req.body, campusId);
    doc.set({ ...req.body, ...extra });
    await doc.save();
    await markCampusDirty(campusId);
    res.status(200).json(doc);
  });

  const remove = asyncHandler(async (req, res) => {
    const campusId = req.campus._id;
    const doc = await r.Model.findOne({ _id: req.params.id, campusId });
    if (!doc) throw new ApiError(404, `${r.label} not found`);
    if (r.guardDelete) await r.guardDelete(doc);
    await doc.deleteOne();
    await markCampusDirty(campusId);
    res.status(204).send();
  });

  return { create, update, remove };
}

const updateGeofence = asyncHandler(async (req, res) => {
  const campus = await Campus.findById(req.campus._id);
  const { boundary, radiusMeters, nearBufferMeters } = req.body;

  if (boundary === null) campus.set("geofence.boundary", undefined);
  else if (boundary) campus.set("geofence.boundary", { type: "Polygon", coordinates: boundary.coordinates });
  if (radiusMeters !== undefined) campus.set("geofence.radiusMeters", radiusMeters);
  if (nearBufferMeters !== undefined) campus.set("geofence.nearBufferMeters", nearBufferMeters);

  await campus.save(); // runs the polygon validation in models/Campus.js
  await markCampusDirty(campus._id);
  res.status(200).json(campus.geofence);
});

const updateSettings = asyncHandler(async (req, res) => {
  const campus = await Campus.findById(req.campus._id);
  const { routing, mapMetadata } = req.body;
  if (routing) for (const [k, v] of Object.entries(routing)) campus.set(`routing.${k}`, v);
  if (mapMetadata) for (const [k, v] of Object.entries(mapMetadata)) campus.set(`mapMetadata.${k}`, v);
  await campus.save();
  await markCampusDirty(campus._id);
  res.status(200).json({ routing: campus.routing, mapMetadata: campus.mapMetadata });
});

const publish = asyncHandler(async (req, res) => {
  const result = await publishPack({ campusId: req.campus._id, publishedBy: req.user.id });
  res.status(result.unchanged ? 200 : 201).json(result);
});

module.exports = {
  building: crud("building"),
  floor: crud("floor"),
  room: crud("room"),
  entrance: crud("entrance"),
  landmark: crud("landmark"),
  updateGeofence,
  updateSettings,
  publish,
};
