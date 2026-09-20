const express = require("express");
const router = express.Router();

const businessController = require("../../controllers/businessController");
const { requireAuth } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../middleware/validateObjectId");
const { validateRequiredFields } = require("../../middleware/validation");

// Must come before "/:id" for the same reason places/nearby does.
router.get("/mine", requireAuth, businessController.getMine);

router.post("/", requireAuth, validateRequiredFields(["name"]), businessController.create);
router.patch("/:id", requireAuth, validateObjectIdParam("id"), businessController.update);

module.exports = router;
