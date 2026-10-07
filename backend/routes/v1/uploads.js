const express = require("express");
const router = express.Router();

const uploadController = require("../../controllers/uploadController");
const { requireAuth } = require("../../middleware/auth");
const upload = require("../../middleware/upload");

router.post("/image", requireAuth, upload.single("image"), uploadController.uploadImage);

module.exports = router;
