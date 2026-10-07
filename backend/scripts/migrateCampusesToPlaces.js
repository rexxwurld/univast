/**
 * Creates one Place per existing Campus, bridged via sourceCampusId, so
 * campuses show up as discoverable Places on the general map without
 * touching University/Campus/Location/NavigationNode/NavigationEdge at all.
 *
 * Idempotent: skips any Campus that already has a Place with matching
 * sourceCampusId, so running it twice is safe.
 *
 * Usage:
 *   node scripts/migrateCampusesToPlaces.js            (dry run — prints only)
 *   node scripts/migrateCampusesToPlaces.js --apply     (writes to the DB)
 */
require("dotenv").config();
const mongoose = require("mongoose");

const connectDB = require("../config/database");
const Campus = require("../models/Campus");
const Place = require("../models/Place");
const Category = require("../models/Category");

const CATEGORY_NAME = "Educational Institution";
const CATEGORY_SLUG = "educational-institution";

async function ensureCategory(apply) {
  let category = await Category.findOne({ slug: CATEGORY_SLUG });
  if (category) return category;

  if (!apply) {
    console.log(`[dry run] would create Category "${CATEGORY_NAME}" (${CATEGORY_SLUG})`);
    return { _id: "DRY-RUN-CATEGORY-ID", name: CATEGORY_NAME };
  }

  category = await Category.create({ name: CATEGORY_NAME, slug: CATEGORY_SLUG });
  console.log(`Created Category "${CATEGORY_NAME}" (${category._id})`);
  return category;
}

async function migrate() {
  const apply = process.argv.includes("--apply");

  await connectDB();

  const category = await ensureCategory(apply);
  const campuses = await Campus.find({});

  console.log(`Found ${campuses.length} campus(es).`);

  let created = 0;
  let skipped = 0;

  for (const campus of campuses) {
    const existing = await Place.findOne({ sourceCampusId: campus._id });
    if (existing) {
      skipped++;
      continue;
    }

    const placeData = {
      name: campus.name,
      category: category._id,
      description: campus.description || "",
      location: { type: "Point", coordinates: [campus.longitude, campus.latitude] },
      source: "seed",
      sourceCampusId: campus._id,
    };

    if (!apply) {
      console.log(`[dry run] would create Place for campus "${campus.name}" (${campus._id})`);
      created++;
      continue;
    }

    await Place.create(placeData);
    console.log(`Created Place for campus "${campus.name}" (${campus._id})`);
    created++;
  }

  console.log(`\nDone. ${created} ${apply ? "created" : "would be created"}, ${skipped} already existed.`);
  if (!apply) {
    console.log("This was a dry run — nothing was written. Re-run with --apply to write changes.");
  }

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
