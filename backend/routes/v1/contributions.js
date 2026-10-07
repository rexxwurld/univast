const express = require("express");
const router = express.Router();
const controller = require("../../controllers/contributionController");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { validateBody } = require("../../middleware/validateSchema");
const { validateObjectIdParam } = require("../../middleware/validateObjectId");
const { submission, resubmission, review } = require("../../validators/contributionSchemas");
const { attachEvidence } = require("../../validators/evidenceSchemas");

router.use(requireAuth);
router.get("/mine", controller.mine);
router.get("/", controller.list);
router.post("/", validateBody(submission), controller.create);
router.post("/:id/evidence", validateObjectIdParam("id"), validateBody(attachEvidence), controller.attach);
router.patch("/:id/resubmit", validateObjectIdParam("id"), validateBody(resubmission), controller.resubmit);
router.patch("/:id/review", validateObjectIdParam("id"), requireRole("admin", "moderator", "campus_coordinator"), validateBody(review), controller.review);

module.exports = router;
