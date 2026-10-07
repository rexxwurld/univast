const { reverseGeocode } = require("../utils/geocode");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

/** GET /api/v1/geocode/reverse?lat=&lng= */
const reverse = asyncHandler(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new ApiError(400, "lat is required and must be between -90 and 90");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ApiError(400, "lng is required and must be between -180 and 180");
  }

  let result;
  try {
    result = await reverseGeocode(lat, lng);
  } catch (err) {
    throw new ApiError(502, `Reverse geocoding failed: ${err.message}`);
  }

  if (!result) {
    return res.status(404).json({ message: "No address found for this location" });
  }

  res.status(200).json(result);
});

module.exports = { reverse };
