const Business = require("../models/Business");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const create = asyncHandler(async (req, res) => {
  const { name, description } = req.body;

  const business = await Business.create({ name, description, owner: req.user.id });

  // A user creating their first business becomes a "business" account —
  // this is what lets them claim/create Places tagged source: "business"
  // (see placeController.create) and pass requireRole("business") checks.
  if (req.user.role === "user") {
    await User.findByIdAndUpdate(req.user.id, { role: "business" });
  }

  res.status(201).json(business);
});

const getMine = asyncHandler(async (req, res) => {
  const businesses = await Business.find({ owner: req.user.id }).sort({ createdAt: -1 });
  res.status(200).json(businesses);
});

const update = asyncHandler(async (req, res) => {
  const business = await Business.findById(req.params.id);
  if (!business) throw new ApiError(404, "Business not found");

  if (req.user.role !== "admin" && business.owner.toString() !== req.user.id) {
    throw new ApiError(403, "You do not have permission to modify this business");
  }

  if (req.body.name !== undefined) business.name = req.body.name;
  if (req.body.description !== undefined) business.description = req.body.description;

  // verificationStatus is admin-only — a business can't self-verify.
  if (req.body.verificationStatus !== undefined) {
    if (req.user.role !== "admin") {
      throw new ApiError(403, "Only an admin can change verificationStatus");
    }
    if (!Business.VERIFICATION_STATUSES.includes(req.body.verificationStatus)) {
      throw new ApiError(400, `verificationStatus must be one of: ${Business.VERIFICATION_STATUSES.join(", ")}`);
    }
    business.verificationStatus = req.body.verificationStatus;
  }

  await business.save();
  res.status(200).json(business);
});

module.exports = { create, getMine, update };
