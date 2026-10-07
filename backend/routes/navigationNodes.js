const express = require("express");
const router = express.Router();

const { requireAdminForWrites } = require("../middleware/auth");

// Reads are public; every write to the campus-navigation data needs an admin.
router.use(requireAdminForWrites);

const navigationNodeController = require("../controllers/navigationNodeController");
const { validateObjectIdParam, validateObjectIdBody } = require("../middleware/validateObjectId");
const { validateLatLng, validateEnumField } = require("../middleware/validation");
const NavigationNode = require("../models/NavigationNode");

router.get("/", navigationNodeController.getAll);
router.get("/:id", validateObjectIdParam("id"), navigationNodeController.getOne);

router.post(
  "/",
  validateObjectIdBody(["campusId", { name: "locationId", required: false }]),
  validateLatLng({ required: true }),
  validateEnumField("type", NavigationNode.NODE_TYPES, { required: false }),
  navigationNodeController.create
);

router.put(
  "/:id",
  validateObjectIdParam("id"),
  validateObjectIdBody([
    { name: "campusId", required: false },
    { name: "locationId", required: false },
  ]),
  validateLatLng({ required: false }),
  validateEnumField("type", NavigationNode.NODE_TYPES, { required: false }),
  navigationNodeController.update
);
router.patch(
  "/:id",
  validateObjectIdParam("id"),
  validateObjectIdBody([
    { name: "campusId", required: false },
    { name: "locationId", required: false },
  ]),
  validateLatLng({ required: false }),
  validateEnumField("type", NavigationNode.NODE_TYPES, { required: false }),
  navigationNodeController.update
);

router.delete("/:id", validateObjectIdParam("id"), navigationNodeController.remove);

module.exports = router;
