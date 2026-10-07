/**
 * Pure helpers that combine UNIVAST's own (data-driven, ranked) search results with general-map hits from a
 * geocoder. UNIVAST results always come first: they are the product's own intelligence layer and carry
 * aliases / student terminology that a geocoder cannot know. Geocoder hits are appended, clearly marked
 * `kind: "geo"`, and never reordered above them.
 */
const { canonicalKey } = require("./campusText");
const { haversineDistance } = require("./distance");

const GEO_DUPLICATE_RADIUS_METERS = 75;
const DEFAULT_GEO_MAX = 5;

function toGeoResult(row) {
  return {
    kind: "geo",
    id: row.id,
    name: row.name,
    category: row.category || row.type || "place",
    address: row.displayName || "",
    latitude: row.latitude,
    longitude: row.longitude,
    score: 0,
    matchedOn: null,
    dataSource: "geocoder",
  };
}

/** True when an existing UNIVAST result is (nearly) the same real-world thing as this geocoder row. */
function isDuplicate(row, existing) {
  const rowKey = canonicalKey(row.name);
  if (!rowKey) return false;
  return existing.some((r) => {
    if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return false;
    if (haversineDistance(r.latitude, r.longitude, row.latitude, row.longitude) > GEO_DUPLICATE_RADIUS_METERS) return false;
    const key = canonicalKey(r.name);
    return Boolean(key) && (key === rowKey || key.includes(rowKey) || rowKey.includes(key));
  });
}

/**
 * @param univastResults ranked UNIVAST results (already limited)
 * @param geoRows rows from forwardGeocode()
 * @returns univastResults followed by at most `max` non-duplicate geo results
 */
function mergeGeoResults(univastResults, geoRows, { max = DEFAULT_GEO_MAX } = {}) {
  const geo = [];
  const seen = new Set();
  for (const row of Array.isArray(geoRows) ? geoRows : []) {
    if (geo.length >= max) break;
    if (!row || seen.has(row.id) || isDuplicate(row, univastResults)) continue;
    seen.add(row.id);
    geo.push(toGeoResult(row));
  }
  return [...univastResults, ...geo];
}

module.exports = { mergeGeoResults, toGeoResult, isDuplicate, GEO_DUPLICATE_RADIUS_METERS, DEFAULT_GEO_MAX };
