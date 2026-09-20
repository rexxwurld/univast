const mongoose = require("mongoose");
const Review = require("../models/Review");
const Place = require("../models/Place");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { parsePagination, buildPaginatedResponse } = require("../utils/paginate");

/**
 * Recomputes a Place's cached ratingAvg/ratingCount from its non-hidden
 * reviews. Called after every create/update/delete rather than doing
 * incremental math — a full recompute can't drift out of sync, and a
 * place's review count is small enough that this is cheap.
 */
async function recomputePlaceRating(placeId) {
  const [result] = await Review.aggregate([
    { $match: { place: placeId, isHidden: false } },
    { $group: { _id: "$place", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  await Place.findByIdAndUpdate(placeId, {
    ratingAvg: result ? Math.round(result.avg * 10) / 10 : 0,
    ratingCount: result ? result.count : 0,
  });
}

/** GET /api/v1/reviews?place=<placeId> — paginated, newest first. */
const getByPlace = asyncHandler(async (req, res) => {
  if (!req.query.place) {
    throw new ApiError(400, "Missing required query param: place");
  }

  const { page, limit, skip } = parsePagination(req.query);
  const filter = { place: req.query.place, isHidden: false };

  const [items, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "name"), // never expose email/role on a public review list
    Review.countDocuments(filter),
  ]);

  res.status(200).json(buildPaginatedResponse(items, total, page, limit));
});

const create = asyncHandler(async (req, res) => {
  const { place, rating, text, photos } = req.body;

  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    throw new ApiError(400, "rating must be a number between 1 and 5");
  }

  const placeDoc = await Place.findById(place);
  if (!placeDoc || !placeDoc.isActive) {
    throw new ApiError(400, `place '${place}' does not reference an existing Place`);
  }

  let review;
  try {
    review = await Review.create({ place, rating, text, photos, user: req.user.id });
  } catch (err) {
    // Unique index on {place, user} — friendlier message than a raw 11000.
    if (err.code === 11000) {
      throw new ApiError(409, "You've already reviewed this place. Edit your existing review instead.");
    }
    throw err;
  }

  await recomputePlaceRating(place);
  res.status(201).json(review);
});

const update = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(404, "Review not found");

  if (req.user.role !== "admin" && review.user.toString() !== req.user.id) {
    throw new ApiError(403, "You do not have permission to modify this review");
  }

  if (req.body.rating !== undefined) {
    if (typeof req.body.rating !== "number" || req.body.rating < 1 || req.body.rating > 5) {
      throw new ApiError(400, "rating must be a number between 1 and 5");
    }
    review.rating = req.body.rating;
  }
  if (req.body.text !== undefined) review.text = req.body.text;
  if (req.body.photos !== undefined) review.photos = req.body.photos;

  // Only an admin can hide a review — this is what a report resolution
  // (Phase 6) actually does to a reported review, rather than deleting it
  // outright and losing the record.
  if (req.body.isHidden !== undefined) {
    if (req.user.role !== "admin") {
      throw new ApiError(403, "Only an admin can hide a review");
    }
    review.isHidden = Boolean(req.body.isHidden);
  }

  await review.save();
  await recomputePlaceRating(review.place);
  res.status(200).json(review);
});

const remove = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(404, "Review not found");

  if (req.user.role !== "admin" && review.user.toString() !== req.user.id) {
    throw new ApiError(403, "You do not have permission to delete this review");
  }

  const placeId = review.place;
  await review.deleteOne();
  await recomputePlaceRating(placeId);
  res.status(204).send();
});

module.exports = { getByPlace, create, update, remove };
