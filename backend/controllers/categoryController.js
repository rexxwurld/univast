const Category = require("../models/Category");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const getAll = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.parentCategory) filter.parentCategory = req.query.parentCategory;

  const categories = await Category.find(filter).sort({ name: 1 });
  res.status(200).json(categories);
});

const getOne = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, "Category not found");
  res.status(200).json(category);
});

const create = asyncHandler(async (req, res) => {
  const { name, slug, icon, parentCategory } = req.body;

  if (parentCategory) {
    const parent = await Category.findById(parentCategory);
    if (!parent) {
      throw new ApiError(400, `parentCategory '${parentCategory}' does not reference an existing Category`);
    }
  }

  const category = await Category.create({ name, slug, icon, parentCategory });
  res.status(201).json(category);
});

module.exports = { getAll, getOne, create };
