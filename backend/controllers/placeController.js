const mongoose = require("mongoose");
const Place = require("../models/Place");
const Category = require("../models/Category");
const Business = require("../models/Business");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { parsePagination, buildPaginatedResponse } = require("../utils/paginate");

/** GET /api/v1/places — paginated list, optionally filtered by category or text search. */
const getAll = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { isActive: true };

  if (req.query.category) filter.category = req.query.category;
  if (req.query.q) filter.$text = { $search: req.query.q };

  const [items, total] = await Promise.all([
    Place.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("category", "name slug icon"),
    Place.countDocuments(filter),
  ]);

  res.status(200).json(buildPaginatedResponse(items, total, page, limit));
});

/**
 * GET /api/v1/places/nearby?lat=&lng=&radius=&category=&q=
 * radius is in meters; defaults to 2000 (2km). Uses a $geoNear aggregation
 * (rather than a plain $near find()) so each result comes back with a real
 * distanceMeters field — the mobile app can show "230m away" instead of
 * just an unordered list, and category/name filters can be combined with
 * the geo query in one pass instead of a $near find() that can't take a
 * $text search alongside it.
 */
const getNearby = asyncHandler(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = req.query.radius !== undefined ? parseFloat(req.query.radius) : 2000;

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new ApiError(400, "lat is required and must be between -90 and 90");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ApiError(400, "lng is required and must be between -180 and 180");
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new ApiError(400, "radius must be a positive number of meters");
  }
  if (req.query.category && !mongoose.Types.ObjectId.isValid(req.query.category)) {
    throw new ApiError(400, `Invalid category: '${req.query.category}' is not a valid ObjectId`);
  }

  const { page, limit, skip } = parsePagination(req.query);

  const query = { isActive: true };
  if (req.query.category) query.category = new mongoose.Types.ObjectId(req.query.category);
  if (req.query.q) {
    // Escape regex metacharacters: q is user input, and an unescaped pattern
    // is both a ReDoS vector and a way to throw a 500 with a malformed regex.
    // String() also neutralizes ?q[]=a (array) style input.
    const safeQ = String(req.query.q).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.name = { $regex: safeQ, $options: "i" };
  }

  const pipeline = [
    {
      // Must be the first stage in the pipeline — Mongo requires it.
      $geoNear: {
        near: { type: "Point", coordinates: [lng, lat] },
        distanceField: "distanceMeters",
        maxDistance: radius,
        query,
        spherical: true,
      },
    },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
  ];

  const items = await Place.aggregate(pipeline);

  // $geoNear doesn't give a cheap exact total the way countDocuments does on
  // a plain filter, so pagination here reports hasNextPage only — good
  // enough for "load more" UX. Revisit if an exact total becomes necessary.
  res.status(200).json({
    data: items,
    pagination: { page, limit, hasNextPage: items.length === limit },
  });
});

const getOne = asyncHandler(async (req, res) => {
  const place = await Place.findById(req.params.id).populate("category", "name slug icon");
  if (!place || !place.isActive) throw new ApiError(404, "Place not found");
  res.status(200).json(place);
});

const create = asyncHandler(async (req, res) => {
  const { name, category, description, address, latitude, longitude, phone, website, photos } = req.body;

  const categoryDoc = await Category.findById(category);
  if (!categoryDoc) {
    throw new ApiError(400, `category '${category}' does not reference an existing Category`);
  }

  const place = await Place.create({
    name,
    category,
    description,
    address,
    phone,
    website,
    photos,
    location: { type: "Point", coordinates: [longitude, latitude] },
    source: req.user.role === "business" ? "business" : "user",
    createdBy: req.user.id,
  });

  res.status(201).json(place);
});

/** Only the place's creator, or an admin, may modify/delete it. Places with
 * no createdBy (e.g. from the Campus migration) have no human author, so
 * only an admin can touch them. */
function assertCanModify(place, user) {
  if (user.role === "admin") return;
  if (place.createdBy && place.createdBy.toString() === user.id) return;
  throw new ApiError(403, "You do not have permission to modify this place");
}

const UPDATABLE_FIELDS = [
  "name",
  "description",
  "address",
  "phone",
  "website",
  "photos",
  "openingHours",
];

const update = asyncHandler(async (req, res) => {
  const place = await Place.findById(req.params.id);
  if (!place || !place.isActive) throw new ApiError(404, "Place not found");

  assertCanModify(place, req.user);

  for (const field of UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) place[field] = req.body[field];
  }

  if (req.body.category !== undefined) {
    const categoryDoc = await Category.findById(req.body.category);
    if (!categoryDoc) {
      throw new ApiError(400, `category '${req.body.category}' does not reference an existing Category`);
    }
    place.category = req.body.category;
  }

  const { latitude, longitude } = req.body;
  if (latitude !== undefined || longitude !== undefined) {
    place.location = {
      type: "Point",
      coordinates: [
        longitude !== undefined ? longitude : place.location.coordinates[0],
        latitude !== undefined ? latitude : place.location.coordinates[1],
      ],
    };
  }

  await place.save();
  res.status(200).json(place);
});

/** Soft delete — sets isActive: false rather than removing the document, so
 * a place's history (reviews, favorites referencing it, later) stays intact. */
const remove = asyncHandler(async (req, res) => {
  const place = await Place.findById(req.params.id);
  if (!place || !place.isActive) throw new ApiError(404, "Place not found");

  assertCanModify(place, req.user);

  place.isActive = false;
  await place.save();
  res.status(204).send();
});

/**
 * POST /api/v1/places/:id/claim — a business account attaches one of its
 * Business profiles to an unclaimed Place. Requires requireRole("business")
 * at the route level. A place can only be claimed once; claiming an
 * already-claimed place is a conflict, not silently overwritten.
 */
const claim = asyncHandler(async (req, res) => {
  const { businessId } = req.body;

  const place = await Place.findById(req.params.id);
  if (!place || !place.isActive) throw new ApiError(404, "Place not found");

  if (place.businessId) {
    throw new ApiError(409, "This place has already been claimed by a business");
  }

  const business = await Business.findById(businessId);
  if (!business) {
    throw new ApiError(400, `businessId '${businessId}' does not reference an existing Business`);
  }
  if (req.user.role !== "admin" && business.owner.toString() !== req.user.id) {
    throw new ApiError(403, "You can only claim places using a business you own");
  }

  place.businessId = businessId;
  place.source = "business";
  await place.save();

  res.status(200).json(place);
});

module.exports = { getAll, getNearby, getOne, create, update, remove, claim };
