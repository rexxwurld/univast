const express = require("express");
const router = express.Router();

const placeController = require("../../controllers/placeController");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { validateObjectIdParam, validateObjectIdBody } = require("../../middleware/validateObjectId");
const { validateRequiredFields, validateLatLng } = require("../../middleware/validation");
const { validateBody } = require("../../middleware/validateSchema");
const { createPlaceSchema, updatePlaceSchema } = require("../../validators/schemas");

router.get("/", placeController.getAll);

// Must come before "/:id" — otherwise Express matches "nearby" as an :id
// value and validateObjectIdParam rejects it as an invalid ObjectId.
router.get("/nearby", placeController.getNearby);

router.get("/:id", validateObjectIdParam("id"), placeController.getOne);

router.post(
  "/",
  requireAuth,
  validateRequiredFields(["name", "category"]),
  validateObjectIdBody(["category"]),
  validateLatLng({ required: true }),
  validateBody(createPlaceSchema),
  placeController.create
);

router.patch(
  "/:id",
  requireAuth,
  validateObjectIdParam("id"),
  validateObjectIdBody([{ name: "category", required: false }]),
  validateLatLng({ required: false }),
  validateBody(updatePlaceSchema),
  placeController.update
);

router.delete("/:id", requireAuth, validateObjectIdParam("id"), placeController.remove);

router.post(
  "/:id/claim",
  requireAuth,
  requireRole("business", "admin"),
  validateObjectIdParam("id"),
  validateRequiredFields(["businessId"]),
  validateObjectIdBody(["businessId"]),
  placeController.claim
);

module.exports = router;
