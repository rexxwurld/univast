const express = require("express");
const router = express.Router();

const adminController = require("../../controllers/adminController");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../middleware/validateObjectId");
const { validateRequiredFields } = require("../../middleware/validation");

// Every route below is admin-only — applied once for the whole router rather
// than repeated on each line.
router.use(requireAuth, requireRole("admin"));

router.get("/users", adminController.listUsers);
router.patch("/users/:id/role", validateObjectIdParam("id"), validateRequiredFields(["role"]), adminController.updateUserRole);
router.get("/stats", adminController.getStats);

module.exports = router;
