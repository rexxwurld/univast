const ApiError = require("../utils/ApiError");

/**
 * Catches any request that didn't match a route above it and turns it
 * into a normal 404 that flows through the centralized error handler,
 * instead of Express's default HTML error page.
 */
function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;
