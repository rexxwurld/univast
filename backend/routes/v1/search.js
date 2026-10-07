const express = require("express");
const router = express.Router();

const { searchGlobal, loadGlobalCandidates } = require("../../services/globalSearchService");
const { requireAuth, requireRole } = require("../../middleware/auth");

const parseCoordinate = (value, min, max) => {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/**
 * GET /api/v1/search?q=&limit=&geo=1&lat=&lng=
 * The single search endpoint: UNIVAST data (aliases, campus places, businesses) first, and — only when
 * `geo=1` — general map places from the geocoder after it. `geo` must be sent only for a submitted search,
 * never per keystroke (geocoder usage policy). `lat`/`lng` only bias geocoder results.
 */
router.get("/", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const includeGeo = req.query.geo === "1" || req.query.geo === "true";
    const latitude = parseCoordinate(req.query.lat, -90, 90);
    const longitude = parseCoordinate(req.query.lng, -180, 180);
    const near = latitude !== null && longitude !== null ? { latitude, longitude } : null;

    const result = await searchGlobal({ query: q, limit, includeGeo, near });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// Admin-only diagnostics. This used to be public and returned the raw database documents of every searchable
// entity; it now needs an admin and returns only the searchable projection.
router.get("/candidates", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const data = await loadGlobalCandidates();
    res.status(200).json({ results: data.map(({ doc, ...candidate }) => candidate) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
