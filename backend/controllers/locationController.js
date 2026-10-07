const Location = require("../models/Location");
const Campus = require("../models/Campus");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const getAll = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.campusId) filter.campusId = req.query.campusId;
  if (req.query.category) filter.category = req.query.category;

  const locations = await Location.find(filter).sort({ name: 1 });
  res.status(200).json(locations);
});

const getOne = asyncHandler(async (req, res) => {
  const location = await Location.findById(req.params.id);
  if (!location) {
    throw new ApiError(404, "Location not found");
  }
  res.status(200).json(location);
});

const create = asyncHandler(async (req, res) => {
  const { campusId, name, category, description, latitude, longitude, aliases } = req.body;

  const campus = await Campus.findById(campusId);
  if (!campus) {
    throw new ApiError(400, `campusId '${campusId}' does not reference an existing Campus`);
  }

  const location = await Location.create({
    campusId,
    name,
    category,
    description,
    latitude,
    longitude,
    aliases,
  });
  res.status(201).json(location);
});

const update = asyncHandler(async (req, res) => {
  const { campusId, name, category, description, latitude, longitude, aliases } = req.body;

  if (campusId !== undefined) {
    const campus = await Campus.findById(campusId);
    if (!campus) {
      throw new ApiError(400, `campusId '${campusId}' does not reference an existing Campus`);
    }
  }

  const update = {};
  if (campusId !== undefined) update.campusId = campusId;
  if (name !== undefined) update.name = name;
  if (category !== undefined) update.category = category;
  if (description !== undefined) update.description = description;
  if (latitude !== undefined) update.latitude = latitude;
  if (longitude !== undefined) update.longitude = longitude;
  if (aliases !== undefined) update.aliases = aliases;

  const location = await Location.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  });

  if (!location) {
    throw new ApiError(404, "Location not found");
  }
  res.status(200).json(location);
});

const remove = asyncHandler(async (req, res) => {
  const location = await Location.findByIdAndDelete(req.params.id);
  if (!location) {
    throw new ApiError(404, "Location not found");
  }
  res.status(200).json({ message: "Location deleted", id: req.params.id });
});

module.exports = { getAll, getOne, create, update, remove };
