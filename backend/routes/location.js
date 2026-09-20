const express = require("express");
const router = express.Router();

const { requireAdminForWrites } = require("../middleware/auth");

// Reads are public; every write to the campus-navigation data needs an admin.
router.use(requireAdminForWrites);

const locationController = require("../controllers/locationController");
const { validateObjectIdParam, validateObjectIdBody } = require("../middleware/validateObjectId");
const { validateRequiredFields, validateLatLng } = require("../middleware/validation");

router.get("/", locationController.getAll);
router.get("/:id", validateObjectIdParam("id"), locationController.getOne);

router.post(
  "/",
  validateObjectIdBody(["campusId"]),
  validateRequiredFields(["name", "category"]),
  validateLatLng({ required: true }),
  locationController.create
);

router.put(
  "/:id",
  validateObjectIdParam("id"),
  validateObjectIdBody([{ name: "campusId", required: false }]),
  validateLatLng({ required: false }),
  locationController.update
);
router.patch(
  "/:id",
  validateObjectIdParam("id"),
  validateObjectIdBody([{ name: "campusId", required: false }]),
  validateLatLng({ required: false }),
  locationController.update
);

router.delete("/:id", validateObjectIdParam("id"), locationController.remove);

module.exports = router;
