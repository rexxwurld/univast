const Campus = require("../models/Campus");
const University = require("../models/University");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const getAll = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.universityId) filter.universityId = req.query.universityId;

  const campuses = await Campus.find(filter).sort({ name: 1 });
  res.status(200).json(campuses);
});

const getOne = asyncHandler(async (req, res) => {
  const campus = await Campus.findById(req.params.id);
  if (!campus) {
    throw new ApiError(404, "Campus not found");
  }
  res.status(200).json(campus);
});

const create = asyncHandler(async (req, res) => {
  const { universityId, name, description, latitude, longitude } = req.body;

  const university = await University.findById(universityId);
  if (!university) {
    throw new ApiError(400, `universityId '${universityId}' does not reference an existing University`);
  }

  const campus = await Campus.create({ universityId, name, description, latitude, longitude });
  res.status(201).json(campus);
});

const update = asyncHandler(async (req, res) => {
  const { universityId, name, description, latitude, longitude } = req.body;

  if (universityId !== undefined) {
    const university = await University.findById(universityId);
    if (!university) {
      throw new ApiError(400, `universityId '${universityId}' does not reference an existing University`);
    }
  }

  const update = {};
  if (universityId !== undefined) update.universityId = universityId;
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (latitude !== undefined) update.latitude = latitude;
  if (longitude !== undefined) update.longitude = longitude;

  const campus = await Campus.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  });

  if (!campus) {
    throw new ApiError(404, "Campus not found");
  }
  res.status(200).json(campus);
});

const remove = asyncHandler(async (req, res) => {
  const campus = await Campus.findByIdAndDelete(req.params.id);
  if (!campus) {
    throw new ApiError(404, "Campus not found");
  }
  res.status(200).json({ message: "Campus deleted", id: req.params.id });
});

module.exports = { getAll, getOne, create, update, remove };
