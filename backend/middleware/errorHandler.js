/**
 * Centralized error handler. Must be registered last, after all routes
 * and after notFound.js. Normalizes Mongoose errors and ApiError instances
 * into a consistent { message, errors? } JSON shape, and never leaks
 * stack traces or internals in production.
 */
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let errors;

  // Invalid ObjectId reaching Mongoose directly (defensive — validateObjectId
  // middleware should normally catch this first).
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}: '${err.value}'`;
  }

  // Mongoose schema validation errors.
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Validation failed";
    errors = Object.values(err.errors).map((e) => e.message);
  }

  // Duplicate key error (e.g. the NavigationEdge unique compound index).
  if (err.code === 11000) {
    statusCode = 400;
    const fields = Object.keys(err.keyValue || {}).join(", ");
    message = `Duplicate value for field(s): ${fields}`;
  }

  const isProduction = process.env.NODE_ENV === "production";

  const body = { message };
  if (errors) body.errors = errors;
  if (!isProduction && err.stack && statusCode === 500) {
    body.stack = err.stack;
  }

  if (statusCode === 500 && !err.isOperational) {
    console.error("Unexpected error:", err);
  }

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
