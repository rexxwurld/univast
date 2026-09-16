const express = require("express");
const router = express.Router();

const campusController = require("../controllers/campusController");
const { validateObjectIdParam, validateObjectIdBody } = require("../middleware/validateObjectId");
const { validateRequiredFields, validateLatLng } = require("../middleware/validation");

router.get("/", campusController.getAll);
router.get("/:id", validateObjectIdParam("id"), campusController.getOne);

router.post(
  "/",
  validateObjectIdBody(["universityId"]),
  validateRequiredFields(["name"]),
  validateLatLng({ required: true }),
  campusController.create
);

router.put(
  "/:id",
  validateObjectIdParam("id"),
  validateObjectIdBody([{ name: "universityId", required: false }]),
  validateLatLng({ required: false }),
  campusController.update
);
router.patch(
  "/:id",
  validateObjectIdParam("id"),
  validateObjectIdBody([{ name: "universityId", required: false }]),
  validateLatLng({ required: false }),
  campusController.update
);

router.delete("/:id", validateObjectIdParam("id"), campusController.remove);

module.exports = router;
