const mongoose = require("mongoose");

// Where a Place record came from — lets us tell "we auto-created this from
// existing campus data" apart from "a user added this" apart from "a claimed
// business manages this", without ever deleting or reshaping the source data.
const SOURCE_TYPES = ["seed", "user", "business"];

const placeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    description: { type: String, default: "" },
    address: { type: String, default: "" },

    // GeoJSON Point — required shape for a 2dsphere index and $near/$geoWithin
    // queries. NOTE: GeoJSON coordinate order is [longitude, latitude], the
    // opposite of the {latitude, longitude} fields used on the older
    // Campus/Location/NavigationNode models — easy to get backwards.
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        validate: {
          validator: (coords) =>
            Array.isArray(coords) &&
            coords.length === 2 &&
            coords[0] >= -180 &&
            coords[0] <= 180 &&
            coords[1] >= -90 &&
            coords[1] <= 90,
          message: "location.coordinates must be [lng, lat] within valid ranges",
        },
      },
    },

    phone: { type: String, default: "" },
    website: { type: String, default: "" },

    // Simple day -> "9:00 AM - 5:00 PM" text map for MVP. A structured
    // open/close-time model can replace this later without touching the
    // rest of the schema.
    openingHours: {
      type: Map,
      of: String,
      default: undefined,
    },

    photos: [{ type: String, trim: true }], // photo URLs; upload pipeline is a later phase

    source: { type: String, enum: SOURCE_TYPES, default: "user" },

    // Bridge to existing data — set only for Places generated from the
    // Campus collection by scripts/migrateCampusesToPlaces.js. Never required,
    // never used for anything but backlinking to the nav-graph feature later.
    sourceCampusId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campus",
      default: null,
    },

    // Reserved for the Business-accounts phase (V1). Left unenforced now so
    // adding real business-claim logic later doesn't require another
    // migration.
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      default: null,
    },

    // The authenticated User who created this place (Phase 2). Null for
    // records made by the migration script — there's no human author.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Cached aggregates, kept in sync by review logic once Review exists
    // (Phase 5). Avoids a COUNT/AVG query on every place-list request.
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true }, // soft-delete / moderation flag
  },
  { timestamps: true }
);

// The index that makes "places near me" fast at any scale.
placeSchema.index({ location: "2dsphere" });
placeSchema.index({ category: 1 });
placeSchema.index({ sourceCampusId: 1 }, { sparse: true });
placeSchema.index({ businessId: 1 }, { sparse: true });
placeSchema.index({ name: "text", description: "text" });

placeSchema.statics.SOURCE_TYPES = SOURCE_TYPES;

module.exports = mongoose.model("Place", placeSchema);
