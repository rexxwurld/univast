const mongoose = require("mongoose");
const { provenanceFields } = require("../utils/provenance");
const { validateRing } = require("../utils/geofence");

const campusSchema = new mongoose.Schema(
  {
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // Campus centre (legacy field names kept).
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },

    // Per-campus boundary configuration. There is NO global default radius:
    // with no polygon and no radius, classification returns "unknown" (utils/geofence.js).
    geofence: {
      // GeoJSON Polygon, outer ring only, coordinates are [longitude, latitude].
      boundary: {
        type: { type: String, enum: ["Polygon"] },
        coordinates: { type: [[[Number]]], default: undefined },
      },
      radiusMeters: { type: Number, min: 0, default: null }, // circle fallback around the centre
      nearBufferMeters: { type: Number, min: 0, default: 0 }, // "near campus" band; 0 = none
    },

    routing: {
      // How far from the walking graph a user may be and still be snapped onto it.
      maxSnapMeters: { type: Number, min: 1, default: 150 },
      // Walking-time assumption for ETAs (m/s). See utils/routeMetrics.js.
      walkingSpeedMetersPerSecond: { type: Number, min: 0.3, max: 3, default: 1.34 },
      // Navigation behaviour handed to the app in every route's metadata, so the phone has no magic numbers:
      // how far off the route (m) before rerouting is considered ...
      rerouteDeviationMeters: { type: Number, min: 5, default: 30 },
      // ... the minimum gap between reroute requests (s) ...
      rerouteMinIntervalSeconds: { type: Number, min: 1, default: 15 },
      // ... and how close to the end (m) counts as "arrived".
      arrivalRadiusMeters: { type: Number, min: 1, default: 15 },
    },

    mapMetadata: {
      defaultZoom: { type: Number, min: 0, max: 24 },
      minZoom: { type: Number, min: 0, max: 24 },
      maxZoom: { type: Number, min: 0, max: 24 },
      notes: { type: String, default: "", maxlength: 1000 },
    },

    // Offline campus-pack versioning (see services/campusPackService.js).
    pack: {
      currentVersion: { type: Number, default: 0, min: 0 },
      hasUnpublishedChanges: { type: Boolean, default: true },
      lastPublishedAt: { type: Date, default: null },
    },

    ...provenanceFields,
  },
  { timestamps: true }
);

campusSchema.pre("validate", async function checkBoundary() {
  const boundary = this.geofence && this.geofence.boundary;
  if (boundary && boundary.coordinates && boundary.coordinates.length) {
    boundary.type = "Polygon";
    if (boundary.coordinates.length > 1) {
      this.invalidate("geofence.boundary", "holes (additional rings) are not supported yet");
    }
    const problems = validateRing(boundary.coordinates[0]);
    if (problems.length) this.invalidate("geofence.boundary", problems.join("; "));
  }
});

campusSchema.index({ universityId: 1 });
campusSchema.index({ name: 1 });

campusSchema.plugin(require("./plugins/searchIndexInvalidation"));

module.exports = mongoose.model("Campus", campusSchema);
