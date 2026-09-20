/**
 * Routing-engine endpoints (shortest walking route, nearest node lookup).
 * Mounted at /api/routes in server.js. Kept separate from navigationNodes.js
 * (CRUD for nodes, mounted at /api/navigation) so route-graph logic doesn't
 * get mixed in with plain resource CRUD.
 */
const express = require("express");
const router = express.Router();

const routeController = require("../controllers/routeController");
const { validateObjectIdBody } = require("../middleware/validateObjectId");
const { validateRequiredFields, validateLatLng } = require("../middleware/validation");

router.post(
  "/route",
  validateObjectIdBody(["campusId", "startNodeId", "endNodeId"]),
  routeController.getShortestRoute
);

router.post(
  "/nearest-node",
  validateObjectIdBody(["campusId"]),
  validateLatLng({ required: true }),
  routeController.getNearestNode
);

module.exports = router;
