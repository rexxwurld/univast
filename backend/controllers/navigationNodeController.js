const NavigationNode = require("../models/NavigationNode");
const Campus = require("../models/Campus");
const Location = require("../models/Location");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const getAll = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.campusId) filter.campusId = req.query.campusId;

  const nodes = await NavigationNode.find(filter).sort({ createdAt: 1 });
  res.status(200).json(nodes);
});

const getOne = asyncHandler(async (req, res) => {
  const node = await NavigationNode.findById(req.params.id);
  if (!node) {
    throw new ApiError(404, "Navigation node not found");
  }
  res.status(200).json(node);
});

const create = asyncHandler(async (req, res) => {
  const { campusId, name, type, latitude, longitude, locationId } = req.body;

  const campus = await Campus.findById(campusId);
  if (!campus) {
    throw new ApiError(400, `campusId '${campusId}' does not reference an existing Campus`);
  }

  if (locationId) {
    const location = await Location.findById(locationId);
    if (!location) {
      throw new ApiError(400, `locationId '${locationId}' does not reference an existing Location`);
    }
  }

  const node = await NavigationNode.create({
    campusId,
    name,
    type,
    latitude,
    longitude,
    locationId: locationId || null,
  });
  res.status(201).json(node);
});

const update = asyncHandler(async (req, res) => {
  const { campusId, name, type, latitude, longitude, locationId } = req.body;

  if (campusId !== undefined) {
    const campus = await Campus.findById(campusId);
    if (!campus) {
      throw new ApiError(400, `campusId '${campusId}' does not reference an existing Campus`);
    }
  }

  if (locationId) {
    const location = await Location.findById(locationId);
    if (!location) {
      throw new ApiError(400, `locationId '${locationId}' does not reference an existing Location`);
    }
  }

  const update = {};
  if (campusId !== undefined) update.campusId = campusId;
  if (name !== undefined) update.name = name;
  if (type !== undefined) update.type = type;
  if (latitude !== undefined) update.latitude = latitude;
  if (longitude !== undefined) update.longitude = longitude;
  if (locationId !== undefined) update.locationId = locationId || null;

  const node = await NavigationNode.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  });

  if (!node) {
    throw new ApiError(404, "Navigation node not found");
  }
  res.status(200).json(node);
});

const remove = asyncHandler(async (req, res) => {
  const node = await NavigationNode.findByIdAndDelete(req.params.id);
  if (!node) {
    throw new ApiError(404, "Navigation node not found");
  }
  res.status(200).json({ message: "Navigation node deleted", id: req.params.id });
});

module.exports = { getAll, getOne, create, update, remove };
