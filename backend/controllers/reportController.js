const mongoose = require("mongoose");
const Report = require("../models/Report");
const Place = require("../models/Place");
const Review = require("../models/Review");
const Business = require("../models/Business");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { parsePagination, buildPaginatedResponse } = require("../utils/paginate");

const MODELS_BY_TYPE = { Place, Review, Business };

const create = asyncHandler(async (req, res) => {
  const { targetType, targetId, reason } = req.body;

  if (!Report.TARGET_TYPES.includes(targetType)) {
    throw new ApiError(400, `targetType must be one of: ${Report.TARGET_TYPES.join(", ")}`);
  }
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new ApiError(400, `targetId '${targetId}' is not a valid id`);
  }

  const targetExists = await MODELS_BY_TYPE[targetType].exists({ _id: targetId });
  if (!targetExists) {
    throw new ApiError(400, `No ${targetType} exists with id '${targetId}'`);
  }

  const report = await Report.create({
    reporter: req.user.id,
    targetType,
    targetId,
    reason,
  });

  res.status(201).json(report);
});

/** GET /api/v1/reports?status=pending — admin only. */
const getAll = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.targetType) filter.targetType = req.query.targetType;

  const [items, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("reporter", "name email")
      .populate("resolvedBy", "name email"),
    Report.countDocuments(filter),
  ]);

  res.status(200).json(buildPaginatedResponse(items, total, page, limit));
});

/** PATCH /api/v1/reports/:id — admin only. Resolve or dismiss a report. */
const resolve = asyncHandler(async (req, res) => {
  const { status, resolutionNotes } = req.body;

  if (!["resolved", "dismissed"].includes(status)) {
    throw new ApiError(400, "status must be 'resolved' or 'dismissed'");
  }

  const report = await Report.findById(req.params.id);
  if (!report) throw new ApiError(404, "Report not found");

  report.status = status;
  report.resolutionNotes = resolutionNotes || "";
  report.resolvedBy = req.user.id;
  report.resolvedAt = new Date();
  await report.save();

  res.status(200).json(report);
});

module.exports = { create, getAll, resolve };
