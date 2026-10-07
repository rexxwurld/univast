const ApiError = require("../utils/ApiError");

const GLOBAL_ROLES = ["admin"]; // may edit any campus
const SCOPED_ROLES = ["campus_coordinator"]; // may edit only the campuses in req.user.campusIds

/**
 * Per-campus write authorization for routes with a :campusId param.
 * Must run AFTER requireAuth. Deny by default:
 *   admin               -> any campus
 *   campus_coordinator  -> only campuses listed in their campusIds (empty list = none)
 *   everyone else       -> 403
 *
 * It decides from the id in the URL WITHOUT touching the database, so a coordinator gets the same
 * 403 for a campus they don't manage whether or not that campus exists (no existence probing).
 * Role and campusIds are re-read from the database by requireAuth on every request, so revoking
 * access takes effect immediately.
 */
function requireCampusAccess(req, res, next) {
  const user = req.user;
  if (!user) return next(new ApiError(401, "Authentication required"));
  if (GLOBAL_ROLES.includes(user.role)) return next();
  if (SCOPED_ROLES.includes(user.role) && (user.campusIds || []).includes(String(req.params.campusId))) return next();
  return next(new ApiError(403, "Insufficient permissions for this campus"));
}

module.exports = { requireCampusAccess, GLOBAL_ROLES, SCOPED_ROLES };
