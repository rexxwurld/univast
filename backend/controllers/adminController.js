const User = require("../models/User");
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

module.exports = { listUsers, updateUserRole, getStats };
