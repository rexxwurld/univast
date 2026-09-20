const { verifyToken } = require("../utils/jwt");
const ApiError = require("../utils/ApiError");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Verifies the Bearer token and attaches req.user = { id, role, email }.
 * Any route wrapped with this becomes login-required — this is the same
 * middleware Favorites, Reviews, and Business-management routes will use
 * once those exist, so auth stays consistent across the whole API.
 */
const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new ApiError(401, "Authentication required");
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired token");
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw new ApiError(401, "User no longer exists");
  }

  req.user = { id: user._id.toString(), role: user.role, email: user.email };
  next();
});

/** Use after requireAuth: requireRole("business", "admin") etc. */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "Insufficient permissions"));
    }
    next();
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * For the legacy campus-navigation CRUD routers: reads stay public (the mobile
 * app needs them), but every write (POST/PUT/PATCH/DELETE) requires an admin.
 * Usage: router.use(requireAdminForWrites) at the top of the router.
 */
const requireAdminForWrites = [
  (req, res, next) => (SAFE_METHODS.has(req.method) ? next() : requireAuth(req, res, next)),
  (req, res, next) => (SAFE_METHODS.has(req.method) ? next() : requireRole("admin")(req, res, next)),
];

module.exports = { requireAuth, requireRole, requireAdminForWrites };
