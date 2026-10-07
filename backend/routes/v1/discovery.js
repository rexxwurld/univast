const express = require("express");
const router = express.Router();
const controller = require("../../controllers/discoveryController");
const { validateObjectIdParam } = require("../../middleware/validateObjectId");

router.get("/:campusId/search", validateObjectIdParam("campusId"), controller.search);

module.exports = router;
