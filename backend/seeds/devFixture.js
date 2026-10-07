/**
 * DEV_FIXTURE — synthetic data used ONLY to prove the architecture end to end.
 *
 * It is NOT real university data. Every record carries dataSource = "DEV_FIXTURE", and the
 * coordinates are deliberately fictional (a few hundred metres around latitude 0, longitude 0
 * in the Gulf of Guinea) so it can never be mistaken for a real campus on a map.
 *
 * Layout (metres are approximate):
 *
 *   Demo Main Gate ──100m── Demo Junction ──55m── Demo Library ──55m── (bend) ──55m── Main Entrance ─► Test Science Block
 *                               │                                                          └ Ground Floor ─► LT1
 *                              100m
 *                               └── Demo Hostel Path (dead end)
 *
 * Remove cleanly with removeDevFixture() / `npm run remove:dev-fixture` before importing real data.
 */
const University = require("../models/University");
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Entrance = require("../models/Entrance");
const Landmark = require("../models/Landmark");
const Location = require("../models/Location");
const NavigationNode = require("../models/NavigationNode");
const NavigationEdge = require("../models/NavigationEdge");
const CampusPack = require("../models/CampusPack");
const { haversineDistance } = require("../utils/distance");
const { publishPack } = require("../services/campusPackService");

const FIXTURE = "DEV_FIXTURE";
const mark = { dataSource: FIXTURE, verificationStatus: "needs_verification", verificationNotes: "DEV_FIXTURE: synthetic development data, not real" };

async function seedDevFixture({ publish = false } = {}) {
  const existing = await University.findOne({ dataSource: FIXTURE });
  if (existing) {
    const campus = await Campus.findOne({ universityId: existing._id, dataSource: FIXTURE });
    return { created: false, universityId: existing._id, campusId: campus && campus._id };
  }

  const university = await University.create({
    name: "UNIVAST Demo University",
    ShortName: "DEMO",
    abbreviation: "DEMO",
    country: "Demo Country",
    state: "Demo State",
    city: "Demo City",
    ...mark,
  });

  const campus = await Campus.create({
    universityId: university._id,
    name: "Main Campus",
    description: "DEV_FIXTURE campus — synthetic data for development and tests only.",
    latitude: 0.0005,
    longitude: 0.0006,
    geofence: {
      boundary: {
        type: "Polygon",
        coordinates: [[[-0.0003, -0.0003], [0.0022, -0.0003], [0.0022, 0.0014], [-0.0003, 0.0014], [-0.0003, -0.0003]]],
      },
      nearBufferMeters: 200,
    },
    routing: { maxSnapMeters: 150 },
    mapMetadata: { defaultZoom: 18, minZoom: 15, maxZoom: 20, notes: "DEV_FIXTURE" },
    ...mark,
  });
  const campusId = campus._id;

  // ---- walking graph ------------------------------------------------------
  const node = (name, type, latitude, longitude) =>
    NavigationNode.create({ campusId, name, type, latitude, longitude, ...mark });

  const gate = await node("Demo Main Gate", "landmark", 0, 0);
  const junction = await node("Demo Junction", "intersection", 0, 0.0009);
  const hostelPath = await node("Demo Hostel Path", "intersection", 0, 0.0018);
  const library = await node("Demo Library", "landmark", 0.0005, 0.0009);
  const bend = await node("", "intersection", 0.001, 0.0009);
  const entranceNode = await node("Test Science Block Main Entrance", "entrance", 0.001, 0.0004);

  const edge = (a, b) =>
    NavigationEdge.create({
      campusId,
      from: a._id,
      to: b._id,
      distance: Math.round(haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude)),
      bidirectional: true,
      ...mark,
    });
  await edge(gate, junction);
  await edge(junction, hostelPath);
  await edge(junction, library);
  await edge(library, bend);
  await edge(bend, entranceNode);

  // ---- landmarks ----------------------------------------------------------
  const gateLandmark = await Landmark.create({
    campusId, name: "Demo Main Gate", type: "gate", description: "DEV_FIXTURE gate", latitude: 0, longitude: 0,
    aliases: ["Main Gate", "Front Gate"], navigationNodeId: gate._id, ...mark,
  });
  const libraryLandmark = await Landmark.create({
    campusId, name: "Demo Library", type: "library", description: "DEV_FIXTURE library landmark", latitude: 0.0005, longitude: 0.0009,
    aliases: ["Library"], navigationNodeId: library._id, ...mark,
  });

  // ---- building / floor / room / entrance --------------------------------
  const building = await Building.create({
    campusId,
    name: "Test Science Block",
    abbreviation: "TSB",
    type: "faculty",
    description: "DEV_FIXTURE building",
    latitude: 0.001,
    longitude: 0.00025,
    footprint: {
      type: "Polygon",
      coordinates: [[[0.0001, 0.0008], [0.0004, 0.0008], [0.0004, 0.0013], [0.0001, 0.0013], [0.0001, 0.0008]]],
    },
    aliases: ["Test Science", "Old Science Block"],
    ...mark,
  });

  const floor = await Floor.create({ campusId, buildingId: building._id, floorNumber: 0, name: "Ground Floor", ...mark });

  const room = await Room.create({
    campusId,
    buildingId: building._id,
    floorId: floor._id,
    name: "LT1",
    roomNumber: "LT1",
    type: "lecture_hall",
    description: "DEV_FIXTURE lecture theatre",
    capacity: 300,
    aliases: ["LT1", "Lecture Theatre 1", "Lecture Theater 1", "Test LT1"],
    ...mark,
  });

  const entrance = await Entrance.create({
    campusId, buildingId: building._id, name: "Main Entrance", type: "main",
    latitude: 0.001, longitude: 0.0004, navigationNodeId: entranceNode._id, ...mark,
  });

  // A legacy-style Location, so legacy search/data coexist with the new model.
  await Location.create({
    campusId, name: "Demo ATM", category: "atm", description: "DEV_FIXTURE legacy location",
    latitude: 0.0001, longitude: 0.0008, aliases: ["Cash Machine"], ...mark,
  });

  let pack = null;
  if (publish) pack = await publishPack({ campusId });

  return {
    created: true,
    universityId: university._id,
    campusId,
    buildingId: building._id,
    floorId: floor._id,
    roomId: room._id,
    entranceId: entrance._id,
    entranceNodeId: entranceNode._id,
    gateNodeId: gate._id,
    junctionNodeId: junction._id,
    libraryNodeId: library._id,
    gateLandmarkId: gateLandmark._id,
    libraryLandmarkId: libraryLandmark._id,
    pack,
  };
}

/**
 * Removes every DEV_FIXTURE record. Refuses (unless force) when an editor has added real
 * (non-fixture) data under a fixture campus, so real work is never deleted by accident.
 */
async function removeDevFixture({ force = false } = {}) {
  const campuses = await Campus.find({ dataSource: FIXTURE }).select("_id").lean();
  const campusIds = campuses.map((c) => c._id);
  const models = [Entrance, Room, Floor, Landmark, Building, Location, NavigationEdge, NavigationNode];

  if (!force && campusIds.length) {
    let foreign = 0;
    for (const Model of models) {
      foreign += await Model.countDocuments({ campusId: { $in: campusIds }, dataSource: { $ne: FIXTURE } });
    }
    if (foreign > 0) {
      throw new Error(`Refusing to remove DEV_FIXTURE: ${foreign} non-fixture record(s) exist under a fixture campus. Move them first or pass force.`);
    }
  }

  const removed = {};
  for (const Model of models) {
    removed[Model.modelName] = (await Model.deleteMany({ campusId: { $in: campusIds } })).deletedCount;
  }
  removed.CampusPack = (await CampusPack.deleteMany({ campusId: { $in: campusIds } })).deletedCount;
  removed.Campus = (await Campus.deleteMany({ dataSource: FIXTURE })).deletedCount;
  removed.University = (await University.deleteMany({ dataSource: FIXTURE })).deletedCount;
  return removed;
}

module.exports = { seedDevFixture, removeDevFixture, FIXTURE };
