const University = require("../models/University");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const getAll = asyncHandler(async (req, res) => {
  const universities = await University.find().sort({ name: 1 });
  res.status(200).json(universities);
});

const getOne = asyncHandler(async (req, res) => {
  const university = await University.findById(req.params.id);
  if (!university) {
    throw new ApiError(404, "University not found");
  }
  res.status(200).json(university);
});

const create = asyncHandler(async (req, res) => {
  const { name, ShortName, country, state } = req.body;
  const university = await University.create({ name, ShortName, country, state });
  res.status(201).json(university);
});

const update = asyncHandler(async (req, res) => {
  const { name, ShortName, country, state } = req.body;
  const update = {};
  if (name !== undefined) update.name = name;
  if (ShortName !== undefined) update.ShortName = ShortName;
  if (country !== undefined) update.country = country;
  if (state !== undefined) update.state = state;

  const university = await University.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  });

  if (!university) {
    throw new ApiError(404, "University not found");
  }
  res.status(200).json(university);
});

const remove = asyncHandler(async (req, res) => {
  const university = await University.findByIdAndDelete(req.params.id);
  if (!university) {
    throw new ApiError(404, "University not found");
  }
  res.status(200).json({ message: "University deleted", id: req.params.id });
});

module.exports = { getAll, getOne, create, update, remove };
