const mongoose = require("mongoose");

/**
 * A discoverable category of Place (Restaurant, Pharmacy, Educational Institution, ...).
 * Deliberately data-driven rather than an enum: new categories can be added via the API
 * without a code change or redeploy. parentCategory allows subcategories later
 * (e.g. "Fast Food" under "Restaurant") without a schema migration.
 */
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    icon: { type: String, default: "" }, // e.g. an icon key or emoji for the mobile UI
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

categorySchema.index({ parentCategory: 1 });

// Auto-derive slug from name if the caller didn't supply one.
categorySchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
  next();
});

module.exports = mongoose.model("Category", categorySchema);
