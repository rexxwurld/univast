const User = require("../models/User");
const Campus = require("../models/Campus");
const Place = require("../models/Place");
const Review = require("../models/Review");
const Business = require("../models/Business");
const Report = require("../models/Report");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { parsePagination, buildPaginatedResponse } = require("../utils/paginate");

/** GET /api/v1/admin/users?role= — admin only. */
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.role) filter.role = req.query.role;

  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  res.status(200).json(buildPaginatedResponse(items, total, page, limit));
});

/** PATCH /api/v1/admin/users/:id/role — admin only. */
const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (!User.ROLES.includes(role)) {
    throw new ApiError(400, `role must be one of: ${User.ROLES.join(", ")}`);
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, "User not found");

  user.role = role;
  // Campus assignments only mean something for coordinators; drop them on any other role so a
  // later promotion back to coordinator can never silently resurrect old access.
  if (role !== "campus_coordinator") user.campusIds = [];
  await user.save();

  res.status(200).json({ id: user._id, name: user.name, email: user.email, role: user.role });
});

/** GET /api/v1/admin/stats — admin only. Cheap counts, not a full analytics pipeline. */
const getStats = asyncHandler(async (req, res) => {
  const [userCount, placeCount, reviewCount, businessCount, pendingReportCount] = await Promise.all([
    User.countDocuments({}),
    Place.countDocuments({ isActive: true }),
    Review.countDocuments({ isHidden: false }),
    Business.countDocuments({}),
    Report.countDocuments({ status: "pending" }),
  ]);

  res.status(200).json({
    users: userCount,
    places: placeCount,
    reviews: reviewCount,
    businesses: businessCount,
    pendingReports: pendingReportCount,
  });
});

/**
 * PUT /api/v1/admin/users/:id/campuses — admin only. Replaces the campuses a coordinator may edit.
 * Body: { campusIds: [campusId, ...] } ([] revokes all campus access).
 */
const setUserCampuses = asyncHandler(async (req, res) => {
  const { campusIds } = req.body;
  if (!Array.isArray(campusIds) || campusIds.length > 100 || !campusIds.every((id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id))) {
    throw new ApiError(400, "campusIds must be an array of valid campus ids");
  }
  const unique = [...new Set(campusIds)];

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, "User not found");
  if (user.role !== "campus_coordinator") {
    throw new ApiError(409, "Campuses can only be assigned to users with the campus_coordinator role");
  }
  const found = await Campus.countDocuments({ _id: { $in: unique } });
  if (found !== unique.length) throw new ApiError(400, "One or more campusIds do not exist");

  user.campusIds = unique;
  await user.save();
  res.status(200).json({ id: user._id, role: user.role, campusIds: user.campusIds });
});

module.exports = { listUsers, updateUserRole, setUserCampuses, getStats };
