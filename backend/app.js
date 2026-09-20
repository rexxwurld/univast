const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoSanitize = require("express-mongo-sanitize");

const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");
const { generalLimiter } = require("./middleware/rateLimit");

const universityRoutes = require("./routes/universities");
const campusRoutes = require("./routes/campuses");
const locationRoutes = require("./routes/location");
const navigationNodeRoutes = require("./routes/navigationNodes");
const navigationEdgeRoutes = require("./routes/navigationEdges");
const navigationEngineRoutes = require("./routes/navigation");

const categoryRoutes = require("./routes/v1/categories");
const placeRoutes = require("./routes/v1/places");
const authRoutes = require("./routes/v1/auth");
const reviewRoutes = require("./routes/v1/reviews");
const businessRoutes = require("./routes/v1/businesses");
const reportRoutes = require("./routes/v1/reports");
const adminRoutes = require("./routes/v1/admin");
const uploadRoutes = require("./routes/v1/uploads");
const geocodeRoutes = require("./routes/v1/geocode");

// Fail fast on a missing JWT secret, same philosophy as the MongoDB URI
// check in connectDB() — a server that "runs" but can't issue valid tokens
// is worse than one that refuses to start. Runs at require-time, so whatever
// requires this module (server.js, or a test's setup file) must have
// JWT_SECRET set in process.env first.
if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Copy .env.example to .env and set JWT_SECRET.");
  process.exit(1);
}

const app = express();

// Behind a reverse proxy / hosting platform (Render, Railway, Nginx...) the
// client IP arrives in X-Forwarded-For. Without this, rate limiting would see
// every request as coming from the proxy. Set TRUST_PROXY to the number of
// proxy hops (usually 1). Left unset locally.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

app.use(helmet());

// CORS only matters for browsers — the MAUI app is not subject to it.
// CORS_ORIGINS is a comma-separated allowlist (e.g. an admin web dashboard).
// Unset: open in development, closed to browsers in production.
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin:
      allowedOrigins.length > 0
        ? allowedOrigins
        : process.env.NODE_ENV === "production"
        ? false
        : true,
  })
);

// Small limit on purpose: nothing in this API needs large JSON bodies
// (image uploads go through multer, not express.json).
app.use(express.json({ limit: "100kb" }));

// Strips any key starting with "$" or containing "." from req.body/req.query/
// req.params — without this, a query like ?place[$ne]=null becomes the object
// { $ne: null } (Express's default query parser supports bracket notation)
// and gets passed straight into a Mongoose filter as a real operator,
// bypassing whatever filter the route intended. Must come after express.json()
// (needs req.body parsed) and before any route.
app.use(mongoSanitize());

// "combined" (Apache-style, includes IP/referrer/user-agent) in production
// for real request logs; "dev" (concise, colored) locally for readability.
// Silenced entirely under test — a real test run makes many requests and the
// output just drowns out Jest's own results.
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

app.use(generalLimiter);

app.get("/", (req, res) => {
  res.json({ message: "UNIVAST API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "API is healthy" });
});

// Legacy campus-navigation engine. The unversioned /api/<x> aliases were
// removed — UNIVAST.Mobile only calls /api/v1/*. If an external client still
// depends on the old paths, re-add them as a temporary alias.
app.use("/api/v1/universities", universityRoutes);
app.use("/api/v1/campuses", campusRoutes);
app.use("/api/v1/locations", locationRoutes);
app.use("/api/v1/navigation", navigationNodeRoutes);
app.use("/api/v1/navigation-edges", navigationEdgeRoutes);
app.use("/api/v1/routes", navigationEngineRoutes);

app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/places", placeRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/reviews", reviewRoutes);
app.use("/api/v1/businesses", businessRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/uploads", uploadRoutes);
app.use("/api/v1/geocode", geocodeRoutes);

// Must be registered last: 404 catch-all, then centralized error handler.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
