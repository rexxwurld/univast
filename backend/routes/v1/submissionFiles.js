const express = require("express");
const router = express.Router();

const controller = require("../../controllers/submissionFileController");
const { requireAuth } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../middleware/validateObjectId");
const { receiveFiles, verifyFiles } = require("../../middleware/secureUpload");
const { submissionUploadLimiter } = require("../../middleware/rateLimit");

// requireAuth runs BEFORE multer so anonymous callers can't make the server write anything to disk.
router.post("/", requireAuth, submissionUploadLimiter, receiveFiles, verifyFiles, controller.upload);
router.get("/", requireAuth, controller.listMine);
router.get("/:id/download", requireAuth, validateObjectIdParam("id"), controller.download);

module.exports = router;
