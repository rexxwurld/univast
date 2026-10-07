const express = require("express");
const router = express.Router();

const reportController = require("../../controllers/reportController");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../middleware/validateObjectId");
const { validateRequiredFields } = require("../../middleware/validation");

router.post(
  "/",
  requireAuth,
  validateRequiredFields(["targetType", "targetId", "reason"]),
  reportController.create
);

router.get("/", requireAuth, requireRole("admin"), reportController.getAll);
router.patch("/:id", requireAuth, requireRole("admin"), validateObjectIdParam("id"), reportController.resolve);

module.exports = router;
