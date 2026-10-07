/**
 * Campus platform API — mounted at /api/v1/campus-data.
 *
 * PUBLIC (read-only):  campuses, search, locate, buildings, rooms, landmarks, route, pack
 * EDITORS ONLY:        every write. `admin` (any campus) and `campus_coordinator` (only the
 *                      campuses assigned to them), verified server-side on every request.
 *                      `moderator` and ordinary users get 403.
 *
 * The legacy /universities, /campuses, /locations, /navigation, /navigation-edges and
 * /routes routers are unchanged and still available.
 */
const express = require("express");
const router = express.Router();

const data = require("../../controllers/campusDataController");
const admin = require("../../controllers/campusAdminController");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { requireCampusAccess } = require("../../middleware/campusAccess");
const { validateObjectIdParam } = require("../../middleware/validateObjectId");
const { validateBody } = require("../../middleware/validateSchema");
const s = require("../../validators/campusSchemas");

const CAMPUS_EDITOR_ROLES = ["admin", "campus_coordinator"];
// requireCampusAccess: admins are global; coordinators only for campuses assigned to them.
const editors = [requireAuth, requireRole(...CAMPUS_EDITOR_ROLES), requireCampusAccess];

// ---- public ----------------------------------------------------------------
router.get("/campuses", data.listCampuses);

const campusScope = [validateObjectIdParam("campusId"), data.loadCampus];

router.get("/:campusId/search", campusScope, data.search);
router.post("/:campusId/locate", campusScope, validateBody(s.locate), data.locate);
router.get("/:campusId/buildings", campusScope, data.listBuildings);
router.get("/:campusId/buildings/:buildingId", campusScope, validateObjectIdParam("buildingId"), data.getBuilding);
router.get("/:campusId/rooms/:roomId", campusScope, validateObjectIdParam("roomId"), data.getRoom);
router.get("/:campusId/landmarks", campusScope, data.listLandmarks);
router.post("/:campusId/route", campusScope, validateBody(s.routeRequest), data.route);
router.get("/:campusId/pack/version", campusScope, data.packVersion);
router.get("/:campusId/pack", campusScope, data.packDownload);

// ---- editors only ----------------------------------------------------------
// Auth runs BEFORE the campus lookup so an anonymous caller learns nothing about which ids exist.
const write = (...handlers) => [...editors, ...campusScope, ...handlers];
const withId = validateObjectIdParam("id");

router.put("/:campusId/geofence", write(validateBody(s.geofenceSettings), admin.updateGeofence));
router.patch("/:campusId/settings", write(validateBody(s.campusSettings), admin.updateSettings));
router.post("/:campusId/pack/publish", write(admin.publish));

const resources = [
  ["buildings", "building", s.createBuilding, s.updateBuilding],
  ["floors", "floor", s.createFloor, s.updateFloor],
  ["rooms", "room", s.createRoom, s.updateRoom],
  ["entrances", "entrance", s.createEntrance, s.updateEntrance],
  ["landmarks", "landmark", s.createLandmark, s.updateLandmark],
];
for (const [path, name, createSchema, updateSchema] of resources) {
  router.post(`/:campusId/${path}`, write(validateBody(createSchema), admin[name].create));
  router.patch(`/:campusId/${path}/:id`, write(withId, validateBody(updateSchema), admin[name].update));
  router.delete(`/:campusId/${path}/:id`, write(withId, admin[name].remove));
}

module.exports = router;
