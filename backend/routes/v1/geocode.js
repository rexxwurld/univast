const express = require("express");
const router = express.Router();

const geocodeController = require("../../controllers/geocodeController");

router.get("/reverse", geocodeController.reverse);

module.exports = router;
