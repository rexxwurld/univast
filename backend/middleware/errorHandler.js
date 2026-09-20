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

  // ApiError can carry a list of details (e.g. per-field validation messages).
  if (err.isOperational && Array.isArray(err.details)) {
    errors = err.details;
  }

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

  // Multer (file upload) errors — e.g. file too large. These don't carry a
  // statusCode the way ApiError/Mongoose errors do, so without this they'd
  // fall through as a generic, unhelpful 500.
  if (err.name === "MulterError") {
    statusCode = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 5MB)" : `Upload error: ${err.message}`;
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
