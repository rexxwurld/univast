/**
 * Short-lived cache of the global-search candidate list. Building it reads seven collections plus aliases,
 * which is too much to repeat for every keystroke-sized request.
 *
 * Staleness is bounded two ways:
 *  1. writes through Mongoose invalidate it immediately (models/plugins/searchIndexInvalidation.js);
 *  2. a TTL (GLOBAL_SEARCH_CACHE_SECONDS, default 30; 0 disables) covers writes made elsewhere.
 * Disabled by default under NODE_ENV=test so tests that write with the raw driver never see stale data.
 *
 * This is a stop-gap for pilot-scale data (thousands of records). Beyond that the candidates should come from
 * an indexed query instead of an in-memory scan; see docs/AUDIT.md.
 */
let entry = null; // { at, promise }

function ttlMs() {
  const raw = process.env.GLOBAL_SEARCH_CACHE_SECONDS;
  if (raw === undefined || raw === "") return process.env.NODE_ENV === "test" ? 0 : 30000;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

/** @param loader async () => candidates */
function getOrLoad(loader) {
  const ttl = ttlMs();
  if (ttl === 0) return loader();

  if (entry && Date.now() - entry.at < ttl) return entry.promise;

  const promise = loader();
  const mine = { at: Date.now(), promise };
  entry = mine;
  // A failed load must not be served from the cache.
  promise.catch(() => {
    if (entry === mine) entry = null;
  });
  return promise;
}

function invalidate() {
  entry = null;
}

module.exports = { getOrLoad, invalidate };
