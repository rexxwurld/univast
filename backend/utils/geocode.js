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

module.exports = { reverseGeocode };
