const rateLimit = require("express-rate-limit");

// Jest sets NODE_ENV=test automatically. A real test suite makes far more
// than 10 requests to auth endpoints across all its cases — without this,
// the strict authLimiter below would start failing tests with 429s that
// have nothing to do with the thing being tested. Production behavior
// (NODE_ENV !== "test") is completely unaffected.
const isTestEnv = process.env.NODE_ENV === "test";

// Applied to the whole API. Generous — this exists to blunt abuse/scraping,
// not to throttle normal usage. 300 requests / 15 min per IP is roughly
// 1 request every 3 seconds sustained, well above anything a real client
// (map panning + a few searches) would hit.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 100000 : 300,
  standardHeaders: true, // adds RateLimit-* headers
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});

// Auth is a brute-force target — register/login get a much stricter limit
// than the rest of the API. 10 / 15 min is generous for a real user
// (mistyped password a couple of times) but expensive for a credential-
// stuffing attempt.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 100000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again later." },
});

// Refresh happens silently in the background (roughly once per access-token
// lifetime per device), so it gets a higher ceiling than login/register —
// many students can share one campus NAT IP.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 100000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again later." },
});

module.exports = { generalLimiter, authLimiter, refreshLimiter };
