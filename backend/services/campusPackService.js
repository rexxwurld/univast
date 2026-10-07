const crypto = require("crypto");
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
const ApiError = require("../utils/ApiError");
const { CAMPUS_CATEGORIES, ROOM_TYPES } = require("../utils/campusCategories");

const PACK_SCHEMA_VERSION = 1;

// Server bookkeeping that would change a checksum without changing content.
const STRIP = new Set(["__v", "createdAt", "updatedAt"]);

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (typeof value.toHexString === "function") return value.toHexString();
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (STRIP.has(key)) continue;
      out[key] = clean(value[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON: keys sorted at every level, so equal content => equal checksum. */
const canonicalJson = (value) => JSON.stringify(clean(value));
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

async function buildSnapshot(campusId) {
  const campus = await Campus.findById(campusId).lean();
  if (!campus) throw new ApiError(404, "Campus not found");

  const [university, buildings, floors, rooms, entrances, landmarks, locations, nodes, edges] = await Promise.all([
    University.findById(campus.universityId).lean(),
    Building.find({ campusId, isActive: true }).sort({ _id: 1 }).lean(),
    Floor.find({ campusId }).sort({ _id: 1 }).lean(),
    Room.find({ campusId, isActive: true }).sort({ _id: 1 }).lean(),
    Entrance.find({ campusId }).sort({ _id: 1 }).lean(),
    Landmark.find({ campusId, isActive: true }).sort({ _id: 1 }).lean(),
    Location.find({ campusId }).sort({ _id: 1 }).lean(),
    NavigationNode.find({ campusId }).sort({ _id: 1 }).lean(),
    NavigationEdge.find({ campusId }).sort({ _id: 1 }).lean(),
  ]);

  const { pack, ...campusFields } = campus; // the pack counters are not pack content
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    university,
    campus: campusFields,
    categories: { campus: CAMPUS_CATEGORIES, room: ROOM_TYPES },
    buildings,
    floors,
    rooms,
    entrances,
    landmarks,
    locations,
    navigation: { nodes, edges },
  };
}

const containsDevFixture = (snapshot) =>
  [snapshot.campus, snapshot.university, ...snapshot.buildings, ...snapshot.rooms, ...snapshot.landmarks, ...snapshot.navigation.nodes].some(
    (d) => d && d.dataSource === "DEV_FIXTURE"
  );

/**
 * Publishes a new pack version if (and only if) the content changed since the
 * latest published version.
 */
async function publishPack({ campusId, publishedBy = null }) {
  const snapshot = clean(await buildSnapshot(campusId));
  const json = JSON.stringify(snapshot);
  const checksum = sha256(json);

  const latest = await CampusPack.findOne({ campusId }).sort({ version: -1 }).select("-snapshot").lean();
  if (latest && latest.checksum === checksum) {
    await Campus.updateOne({ _id: campusId }, { $set: { "pack.hasUnpublishedChanges": false } });
    return { unchanged: true, version: latest.version, checksum, publishedAt: latest.publishedAt };
  }

  const version = latest ? latest.version + 1 : 1;
  const pack = await CampusPack.create({
    campusId,
    version,
    schemaVersion: PACK_SCHEMA_VERSION,
    checksum,
    sizeBytes: Buffer.byteLength(json),
    containsDevFixture: containsDevFixture(snapshot),
    snapshot,
    publishedBy,
  });

  await Campus.updateOne(
    { _id: campusId },
    { $set: { "pack.currentVersion": version, "pack.hasUnpublishedChanges": false, "pack.lastPublishedAt": pack.publishedAt } }
  );
  return { unchanged: false, version, checksum, publishedAt: pack.publishedAt, sizeBytes: pack.sizeBytes };
}

async function getPackVersion(campusId) {
  const campus = await Campus.findById(campusId).select("pack").lean();
  if (!campus) throw new ApiError(404, "Campus not found");
  const latest = await CampusPack.findOne({ campusId }).sort({ version: -1 }).select("-snapshot").lean();
  return {
    currentVersion: latest ? latest.version : 0,
    checksum: latest ? latest.checksum : null,
    schemaVersion: latest ? latest.schemaVersion : PACK_SCHEMA_VERSION,
    sizeBytes: latest ? latest.sizeBytes : 0,
    publishedAt: latest ? latest.publishedAt : null,
    containsDevFixture: latest ? latest.containsDevFixture : false,
    hasUnpublishedChanges: campus.pack ? campus.pack.hasUnpublishedChanges : true,
  };
}

/** Full pack of the latest version, or `{ upToDate: true }` when the client already has it. */
async function getPack(campusId, { sinceVersion } = {}) {
  const latest = await CampusPack.findOne({ campusId }).sort({ version: -1 }).lean();
  if (!latest) throw new ApiError(404, "No campus pack has been published for this campus yet");
  if (Number.isInteger(sinceVersion) && sinceVersion === latest.version) {
    return { upToDate: true, version: latest.version, checksum: latest.checksum };
  }
  return {
    upToDate: false,
    version: latest.version,
    schemaVersion: latest.schemaVersion,
    checksum: latest.checksum,
    containsDevFixture: latest.containsDevFixture,
    publishedAt: latest.publishedAt,
    snapshot: latest.snapshot,
  };
}

/** Called by admin writes: the live data now differs from the published pack. */
const markCampusDirty = (campusId, session) =>
  Campus.updateOne({ _id: campusId }, { $set: { "pack.hasUnpublishedChanges": true } }, session ? { session } : {});

module.exports = { publishPack, getPackVersion, getPack, markCampusDirty, buildSnapshot, canonicalJson, PACK_SCHEMA_VERSION };
