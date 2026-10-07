const Campus = require("../models/Campus");
const University = require("../models/University");
const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Entrance = require("../models/Entrance");
const Landmark = require("../models/Landmark");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { classifyPoint, hasBoundary } = require("../utils/geofence");
const { searchCampus } = require("../services/campusSearchService");
const { planRoute } = require("../services/campusRoutingService");
const { getPackVersion, getPack } = require("../services/campusPackService");

const HIDE = "-searchKeys -__v";

const LOCATE_MESSAGES = {
  inside: "You're on campus.",
  near: "You're near campus.",
  outside: "You're currently away from campus.",
  unknown: "This campus has no boundary configured yet, so your position can't be placed relative to it.",
};

/** Router-level: loads :campusId into req.campus or 404s. */
const loadCampus = asyncHandler(async (req, res, next) => {
  const campus = await Campus.findById(req.params.campusId).lean();
  if (!campus) throw new ApiError(404, "Campus not found");
  req.campus = campus;
  next();
});

const listCampuses = asyncHandler(async (req, res) => {
  const filter = req.query.universityId ? { universityId: req.query.universityId } : {};
  const campuses = await Campus.find(filter).sort({ name: 1 }).lean();
  const universities = await University.find({ _id: { $in: campuses.map((c) => c.universityId) } }).lean();
  const byId = new Map(universities.map((u) => [String(u._id), u]));

  res.status(200).json(
    campuses.map((c) => {
      const u = byId.get(String(c.universityId));
      return {
        id: String(c._id),
        name: c.name,
        description: c.description,
        latitude: c.latitude,
        longitude: c.longitude,
        university: u ? { id: String(u._id), name: u.name, abbreviation: u.abbreviation || u.ShortName } : null,
        geofenceConfigured: hasBoundary(c.geofence) || Boolean(c.geofence && c.geofence.radiusMeters > 0),
        mapMetadata: c.mapMetadata || {},
        packVersion: c.pack ? c.pack.currentVersion : 0,
        dataSource: c.dataSource,
      };
    })
  );
});

const search = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q.trim()) throw new ApiError(400, "q is required");
  if (q.length > 100) throw new ApiError(400, "q is too long (max 100 characters)");
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  res.status(200).json(await searchCampus({ campusId: req.campus._id, query: q, limit }));
});

const locate = asyncHandler(async (req, res) => {
  const { latitude, longitude, accuracyMeters } = req.body;
  const result = classifyPoint(req.campus.geofence, { latitude, longitude, accuracyMeters }, { latitude: req.campus.latitude, longitude: req.campus.longitude });
  res.status(200).json({ ...result, message: LOCATE_MESSAGES[result.status] });
});

const listBuildings = asyncHandler(async (req, res) => {
  const filter = { campusId: req.campus._id, isActive: true };
  if (req.query.type) filter.type = String(req.query.type);
  const [buildings, entrances] = await Promise.all([
    Building.find(filter).select(HIDE).sort({ name: 1 }).lean(),
    Entrance.find({ campusId: req.campus._id }).select("-__v").lean(),
  ]);
  const entrancesByBuilding = new Map();
  for (const e of entrances) {
    const key = String(e.buildingId);
    if (!entrancesByBuilding.has(key)) entrancesByBuilding.set(key, []);
    entrancesByBuilding.get(key).push(e);
  }
  res.status(200).json(buildings.map((b) => ({ ...b, entrances: entrancesByBuilding.get(String(b._id)) || [] })));
});

const getBuilding = asyncHandler(async (req, res) => {
  const building = await Building.findOne({ _id: req.params.buildingId, campusId: req.campus._id }).select(HIDE).lean();
  if (!building) throw new ApiError(404, "Building not found");
  const [floors, rooms, entrances] = await Promise.all([
    Floor.find({ buildingId: building._id }).select("-__v").sort({ floorNumber: 1 }).lean(),
    Room.find({ buildingId: building._id, isActive: true }).select(HIDE).sort({ name: 1 }).lean(),
    Entrance.find({ buildingId: building._id }).select("-__v").lean(),
  ]);
  res.status(200).json({ ...building, floors, rooms, entrances });
});

const getRoom = asyncHandler(async (req, res) => {
  const room = await Room.findOne({ _id: req.params.roomId, campusId: req.campus._id }).select(HIDE).lean();
  if (!room) throw new ApiError(404, "Room not found");
  const [floor, building, entrances] = await Promise.all([
    Floor.findById(room.floorId).select("-__v").lean(),
    Building.findById(room.buildingId).select(HIDE).lean(),
    Entrance.find({ buildingId: room.buildingId }).select("-__v").lean(),
  ]);
  res.status(200).json({ ...room, floor, building, entrances });
});

const listLandmarks = asyncHandler(async (req, res) => {
  const filter = { campusId: req.campus._id, isActive: true };
  if (req.query.type) filter.type = String(req.query.type);
  res.status(200).json(await Landmark.find(filter).select(HIDE).sort({ name: 1 }).lean());
});

const route = asyncHandler(async (req, res) => {
  res.status(200).json(await planRoute({ campusId: req.campus._id, from: req.body.from, to: req.body.to, options: req.body.options }));
});

const packVersion = asyncHandler(async (req, res) => {
  res.status(200).json(await getPackVersion(req.campus._id));
});

const packDownload = asyncHandler(async (req, res) => {
  const since = req.query.sinceVersion === undefined ? undefined : parseInt(req.query.sinceVersion, 10);
  res.status(200).json(await getPack(req.campus._id, { sinceVersion: Number.isFinite(since) ? since : undefined }));
});

module.exports = { loadCampus, listCampuses, search, locate, listBuildings, getBuilding, getRoom, listLandmarks, route, packVersion, packDownload };
