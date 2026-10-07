const { z } = require("zod");
const { CAMPUS_CATEGORIES, ROOM_TYPES } = require("../utils/campusCategories");

// Unknown keys are stripped — in particular `dataSource`, `campusId`, `searchKeys` can never be
// set by a client. dataSource is assigned server-side ("manual" for editor-created records).

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "must be a valid id");
const lat = z.number().min(-90, "latitude must be between -90 and 90").max(90, "latitude must be between -90 and 90");
const lng = z.number().min(-180, "longitude must be between -180 and 180").max(180, "longitude must be between -180 and 180");
const aliases = z.array(z.string().trim().min(1).max(100)).max(30);
const verification = {
  verificationStatus: z.enum(["unverified", "verified", "needs_verification"]).optional(),
  verificationNotes: z.string().max(1000).optional(),
};

const polygon = z.object({
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1, "polygon needs an outer ring"),
});

// ---- campus data -----------------------------------------------------------

const createBuilding = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  abbreviation: z.string().trim().max(30).optional(),
  type: z.enum(CAMPUS_CATEGORIES).optional(),
  description: z.string().max(2000).optional(),
  latitude: lat,
  longitude: lng,
  footprint: polygon.optional(),
  aliases: aliases.optional(),
  ...verification,
});
const updateBuilding = createBuilding.partial();

const createFloor = z.object({
  buildingId: objectId,
  floorNumber: z.number().int("floorNumber must be an integer (0 = ground)"),
  name: z.string().trim().max(100).optional(),
  ...verification,
});
const updateFloor = createFloor.omit({ buildingId: true }).partial();

const createRoom = z.object({
  floorId: objectId,
  navigationNodeId: objectId.nullable().optional(), // optional indoor graph node for the room
  name: z.string().trim().min(1, "name is required").max(200),
  roomNumber: z.string().trim().max(30).optional(),
  type: z.enum(ROOM_TYPES).optional(),
  description: z.string().max(2000).optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  aliases: aliases.optional(),
  ...verification,
});
const updateRoom = createRoom.partial();

const createEntrance = z.object({
  buildingId: objectId,
  name: z.string().trim().min(1, "name is required").max(100),
  type: z.enum(["main", "secondary", "service", "emergency"]).optional(),
  latitude: lat,
  longitude: lng,
  navigationNodeId: objectId.nullable().optional(),
  isAccessible: z.boolean().nullable().optional(),
  ...verification,
});
const updateEntrance = createEntrance.omit({ buildingId: true }).partial();

const createLandmark = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  type: z.enum(CAMPUS_CATEGORIES).optional(),
  description: z.string().max(2000).optional(),
  latitude: lat,
  longitude: lng,
  aliases: aliases.optional(),
  navigationNodeId: objectId.nullable().optional(),
  ...verification,
});
const updateLandmark = createLandmark.partial();

const geofenceSettings = z.object({
  boundary: polygon.nullable().optional(),
  radiusMeters: z.number().min(0).nullable().optional(),
  nearBufferMeters: z.number().min(0).optional(),
});

const campusSettings = z.object({
  routing: z
    .object({
      maxSnapMeters: z.number().min(1).max(5000).optional(),
      walkingSpeedMetersPerSecond: z.number().min(0.3).max(3).optional(),
      rerouteDeviationMeters: z.number().min(5).max(500).optional(),
      rerouteMinIntervalSeconds: z.number().min(1).max(600).optional(),
      arrivalRadiusMeters: z.number().min(1).max(200).optional(),
    })
    .optional(),
  mapMetadata: z
    .object({
      defaultZoom: z.number().min(0).max(24).optional(),
      minZoom: z.number().min(0).max(24).optional(),
      maxZoom: z.number().min(0).max(24).optional(),
      notes: z.string().max(1000).optional(),
    })
    .optional(),
});

// ---- public read / routing -------------------------------------------------

const locate = z.object({
  latitude: lat,
  longitude: lng,
  accuracyMeters: z.number().min(0).optional(),
});

// Each origin shape is strict: sending two kinds of origin at once ({ nodeId, landmarkId }) is rejected, not guessed at.
const routeFrom = z.union([
  z.object({ latitude: lat, longitude: lng, accuracyMeters: z.number().min(0).optional(), source: z.enum(["device", "map"]).optional() }).strict(),
  z.object({ nodeId: objectId }).strict(),
  z.object({ landmarkId: objectId }).strict(),
  z.object({ entranceId: objectId }).strict(),
]);

const routeRequest = z.object({
  from: routeFrom,
  to: z.object({
    roomId: objectId.optional(),
    buildingId: objectId.optional(),
    entranceId: objectId.optional(),
    landmarkId: objectId.optional(),
  }),
  options: z.object({ accessibleOnly: z.boolean().optional() }).optional(),
});

module.exports = {
  createBuilding, updateBuilding, createFloor, updateFloor, createRoom, updateRoom,
  createEntrance, updateEntrance, createLandmark, updateLandmark,
  geofenceSettings, campusSettings, locate, routeRequest,
};
