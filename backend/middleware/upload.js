const multer = require("multer");
const ApiError = require("../utils/ApiError");

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// memoryStorage — the file lives only in req.file.buffer, never written to
// local disk. Correct choice here since the buffer goes straight to
// Cloudinary; a diskStorage step would just be a redundant, ephemeral copy
// (and most hosts wipe local disk on redeploy anyway).
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new ApiError(400, `Unsupported file type '${file.mimetype}'. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`));
      return;
    }
    cb(null, true);
  },
});

module.exports = upload;
