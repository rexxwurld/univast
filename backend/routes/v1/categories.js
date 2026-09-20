const express = require("express");
const router = express.Router();

const categoryController = require("../../controllers/categoryController");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { validateObjectIdParam, validateObjectIdBody } = require("../../middleware/validateObjectId");
const { validateRequiredFields } = require("../../middleware/validation");

router.get("/", categoryController.getAll);
router.get("/:id", validateObjectIdParam("id"), categoryController.getOne);

// Admin-only — categories are shared taxonomy every place is filed under,
// not user-generated content. Left open (no auth at all) since Phase 1;
// closing that here.
router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  validateRequiredFields(["name"]),
  validateObjectIdBody([{ name: "parentCategory", required: false }]),
  categoryController.create
);

module.exports = router;
