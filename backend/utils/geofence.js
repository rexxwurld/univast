/**
 * Campus geofence math. Pure functions, no dependencies.
 *
 * A campus geofence is configured PER CAMPUS:
 *   boundary          GeoJSON Polygon ({ type:"Polygon", coordinates:[ring] }, [lng,lat])
 *   radiusMeters      fallback circle around the campus centre when no polygon exists
 *   nearBufferMeters  width of the "near campus" band outside the boundary (0 = no band)
 *
 * With neither a polygon nor a radius, the status is "unknown" — the backend
 * refuses to guess. There is intentionally no global default radius.
 */
const { haversineDistance } = require("./distance");

const METERS_PER_DEGREE_LAT = 111320;

function hasBoundary(geofence) {
  const ring = geofence && geofence.boundary && geofence.boundary.coordinates && geofence.boundary.coordinates[0];
  return Array.isArray(ring) && ring.length >= 4;
}

/** Validates an outer ring of [lng,lat] positions. Returns an array of problems (empty = valid). */
function validateRing(ring) {
  const problems = [];
  if (!Array.isArray(ring) || ring.length < 4) {
    return ["ring must contain at least 4 positions (3 corners + the closing position)"];
  }
  for (const position of ring) {
    if (!Array.isArray(position) || position.length < 2 || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
      problems.push("every position must be [longitude, latitude] numbers");
      return problems;
    }
    if (position[0] < -180 || position[0] > 180 || position[1] < -90 || position[1] > 90) {
      problems.push("position out of range (longitude -180..180, latitude -90..90)");
      return problems;
    }
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) problems.push("ring must be closed (first position equals last)");
  return problems;
}

/** Ray casting. Planar in lng/lat — accurate at campus scale, not for huge polygons. */
function pointInRing(latitude, longitude, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > latitude !== yj > latitude && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Distance in meters from a point to the closest point of a segment (local flat projection). */
function distanceToSegmentMeters(latitude, longitude, a, b) {
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const toXY = ([lng, lat]) => [(lng - longitude) * METERS_PER_DEGREE_LAT * cosLat, (lat - latitude) * METERS_PER_DEGREE_LAT];
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : -(ax * dx + ay * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function distanceToRingMeters(latitude, longitude, ring) {
  let min = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    min = Math.min(min, distanceToSegmentMeters(latitude, longitude, ring[i], ring[i + 1]));
  }
  return min;
}

/**
 * Classifies a coordinate against a campus.
 * @param geofence  campus.geofence
 * @param point     { latitude, longitude, accuracyMeters? }
 * @param center    { latitude, longitude } campus centre (used by the circle fallback)
 * @returns { status: "inside"|"near"|"outside"|"unknown", method, distanceToBoundaryMeters,
 *            ambiguous, accuracyMeters }
 *   `ambiguous` is true when the reported GPS accuracy is at least as large as the
 *   distance to the boundary — the side of the line is then not trustworthy.
 */
function classifyPoint(geofence, point, center) {
  const { latitude, longitude } = point;
  const accuracyMeters = Number.isFinite(point.accuracyMeters) ? point.accuracyMeters : null;
  const nearBuffer = (geofence && geofence.nearBufferMeters) || 0;

  let method = "none";
  let isInside = false;
  let boundaryDistance = null;

  if (hasBoundary(geofence)) {
    method = "polygon";
    const ring = geofence.boundary.coordinates[0];
    isInside = pointInRing(latitude, longitude, ring);
    boundaryDistance = distanceToRingMeters(latitude, longitude, ring);
  } else if (geofence && geofence.radiusMeters > 0 && center) {
    method = "radius";
    const distanceToCenter = haversineDistance(latitude, longitude, center.latitude, center.longitude);
    isInside = distanceToCenter <= geofence.radiusMeters;
    boundaryDistance = Math.abs(distanceToCenter - geofence.radiusMeters);
  } else {
    return { status: "unknown", method, distanceToBoundaryMeters: null, ambiguous: false, accuracyMeters };
  }

  let status = "outside";
  if (isInside) status = "inside";
  else if (nearBuffer > 0 && boundaryDistance <= nearBuffer) status = "near";

  const ambiguous = accuracyMeters !== null && accuracyMeters >= boundaryDistance;
  return {
    status,
    method,
    distanceToBoundaryMeters: Math.round(boundaryDistance * 10) / 10,
    ambiguous,
    accuracyMeters,
  };
}

module.exports = { hasBoundary, validateRing, pointInRing, distanceToSegmentMeters, distanceToRingMeters, classifyPoint };
