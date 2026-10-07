const cloudinary = require("cloudinary").v2;

let configured = false;

/**
 * Configures the Cloudinary SDK from env vars on first use. Deliberately NOT
 * a startup fail-fast check like MONGODB_URI/JWT_SECRET — image upload is an
 * optional feature, so a server with no Cloudinary account yet should still
 * start and serve every other endpoint normally. The error only surfaces
 * when someone actually hits POST /api/v1/uploads/image.
 */
function ensureConfigured() {
  if (configured) return;

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env."
    );
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });

  configured = true;
}

module.exports = { cloudinary, ensureConfigured };
