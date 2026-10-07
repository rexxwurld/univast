const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — an address for a given spot doesn't change often

// Simple in-memory cache, keyed by coordinate rounded to 4 decimal places
// (~11m precision). Reduces redundant upstream calls for the same area and
// helps stay within Nominatim's usage policy (max 1 request/second, no API
// key). For real production volume beyond casual/dev use, Nominatim's policy
// asks you to self-host it or move to a paid provider — this cache buys
// headroom, it doesn't remove that ceiling.
const cache = new Map();

function cacheKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * Reverse-geocodes a coordinate into a human-readable address. Returns null
 * (not an error) when Nominatim has no OSM data for that coordinate — that's
 * a normal outcome (open ocean, unmapped area), not a failure.
 */
async function reverseGeocode(lat, lng) {
  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  const url = `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;

  const response = await fetch(url, {
    headers: {
      // Required by Nominatim's usage policy — generic/missing User-Agent
      // strings get blocked. Replace the contact address with a real one
      // before relying on this in production.
      "User-Agent": "UNIVAST/1.0 (contact: set-a-real-contact-email@example.com)",
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed with status ${response.status}`);
  }

  const data = await response.json();
  const value = !data || data.error ? null : { displayName: data.display_name || null, address: data.address || {} };

  cache.set(key, { value, timestamp: Date.now() });
  return value;
}

// ---- forward geocoding (free-text search for places anywhere) ---------------------------------------
//
// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/) allows at most
// 1 request/second and forbids search-as-you-type auto-complete. So:
//   * callers must only ask on an explicit search (the API requires `geo=1`, and the mobile app sends it
//     only for a submitted search, never for debounced keystrokes);
//   * upstream calls are serialized at >= MIN_INTERVAL_MS apart;
//   * identical queries are cached.
// The provider is swappable (GEOCODER_SEARCH_URL) for a self-hosted Nominatim or any compatible service.
const FORWARD_CACHE_TTL_MS = 60 * 60 * 1000;
const FORWARD_CACHE_MAX = 500;
const MIN_INTERVAL_MS = 1100;
const FORWARD_TIMEOUT_MS = 6000;

const forwardCache = new Map();
let upstreamChain = Promise.resolve();
let lastUpstreamAt = 0;

function forwardUrl() {
  return process.env.GEOCODER_SEARCH_URL || "https://nominatim.openstreetmap.org/search";
}

function userAgent() {
  const contact = process.env.GEOCODER_CONTACT || "set-a-real-contact-email@example.com";
  return `UNIVAST/1.0 (contact: ${contact})`;
}

/** Maps one Nominatim jsonv2 row to our shape. Rows without usable coordinates are dropped. */
function mapForwardRow(row) {
  const latitude = Number.parseFloat(row && row.lat);
  const longitude = Number.parseFloat(row && row.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const displayName = String(row.display_name || "").trim();
  const name = String(row.name || "").trim() || displayName.split(",")[0].trim();
  if (!name) return null;

  const osmType = row.osm_type ? String(row.osm_type) : "";
  const osmId = row.osm_id !== undefined && row.osm_id !== null ? String(row.osm_id) : "";
  return {
    id: osmType && osmId ? `osm:${osmType}:${osmId}` : `osm:${latitude.toFixed(5)},${longitude.toFixed(5)}`,
    name,
    displayName,
    category: row.category ? String(row.category) : "",
    type: row.type ? String(row.type) : "",
    latitude,
    longitude,
  };
}

/**
 * Free-text place search via the configured geocoder. Throws on transport/HTTP failure (callers decide how
 * to degrade); returns [] for "nothing found". `near` ({ latitude, longitude }) only BIASES results toward
 * that area (unbounded viewbox) — it never restricts them.
 */
async function forwardGeocode(query, { limit = 5, near = null } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];

  const max = Math.min(Math.max(Number(limit) || 5, 1), 10);
  const biasKey = near ? `${near.latitude.toFixed(1)},${near.longitude.toFixed(1)}` : "";
  const key = `${q.toLowerCase()}|${max}|${biasKey}`;
  const cached = forwardCache.get(key);
  if (cached && Date.now() - cached.timestamp < FORWARD_CACHE_TTL_MS) return cached.value;

  const run = async () => {
    const wait = lastUpstreamAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastUpstreamAt = Date.now();

    const params = new URLSearchParams({ format: "jsonv2", q, limit: String(max), addressdetails: "0" });
    if (near) {
      const d = 0.5; // ~55 km box; a hint only, bounded stays 0
      params.set("viewbox", `${near.longitude - d},${near.latitude + d},${near.longitude + d},${near.latitude - d}`);
      params.set("bounded", "0");
    }

    const response = await fetch(`${forwardUrl()}?${params.toString()}`, {
      headers: { "User-Agent": userAgent(), "Accept-Language": "en" },
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Geocoder request failed with status ${response.status}`);
    const rows = await response.json();
    return (Array.isArray(rows) ? rows : []).map(mapForwardRow).filter(Boolean);
  };

  // Serialize upstream calls so concurrent searches can never exceed the provider's rate limit.
  const result = upstreamChain.then(run, run);
  upstreamChain = result.catch(() => undefined);
  const value = await result;

  if (forwardCache.size >= FORWARD_CACHE_MAX) forwardCache.delete(forwardCache.keys().next().value);
  forwardCache.set(key, { value, timestamp: Date.now() });
  return value;
}

module.exports = { reverseGeocode, forwardGeocode, mapForwardRow };
