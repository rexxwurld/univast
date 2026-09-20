const express = require("express");
const router = express.Router();

const reviewController = require("../../controllers/reviewController");
const { requireAuth } = require("../../middleware/auth");
const { validateObjectIdParam, validateObjectIdBody } = require("../../middleware/validateObjectId");
const { validateRequiredFields } = require("../../middleware/validation");
const { validateBody } = require("../../middleware/validateSchema");
const { createReviewSchema, updateReviewSchema } = require("../../validators/schemas");

router.get("/", reviewController.getByPlace);

router.post(
  "/",
  requireAuth,
  validateRequiredFields(["place", "rating"]),
  validateObjectIdBody(["place"]),
  validateBody(createReviewSchema),
  reviewController.create
);

router.patch(
  "/:id",
  requireAuth,
  validateObjectIdParam("id"),
  validateBody(updateReviewSchema),
  reviewController.update
);
router.delete("/:id", requireAuth, validateObjectIdParam("id"), reviewController.remove);

module.exports = router;
