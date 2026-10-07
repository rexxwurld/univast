const { cloudinary, ensureConfigured } = require("../config/cloudinary");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

/**
 * POST /api/v1/uploads/image — multipart field name "image". Requires auth
 * (an anonymous open upload endpoint is an easy abuse vector). Returns the
 * Cloudinary URL, which the client then attaches to a Place/Review's
 * `photos` array via the normal create/update endpoints — this endpoint
 * only handles the upload itself, not attaching it to anything.
 */
const uploadImage = asyncHandler(async (req, res) => {
  try {
    ensureConfigured();
  } catch (err) {
    throw new ApiError(503, err.message);
  }

  if (!req.file) {
    throw new ApiError(400, "No image file provided (expected multipart field 'image')");
  }

  const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

  let result;
  try {
    result = await cloudinary.uploader.upload(dataUri, {
      folder: "univast",
      resource_type: "image",
    });
  } catch (err) {
    throw new ApiError(502, `Image upload failed: ${err.message}`);
  }

  res.status(201).json({ url: result.secure_url, publicId: result.public_id });
});

module.exports = { uploadImage };
