const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { discoverCampus } = require("../services/campusDiscoveryService");

const search = asyncHandler(async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length > 100) throw new ApiError(400, "Search query must be 100 characters or fewer");
  const result = await discoverCampus({ campusId: req.params.campusId, query });
  res.status(200).json(result);
});

module.exports = { search };
