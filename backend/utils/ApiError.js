/**
 * Operational error with an explicit HTTP status code, so controllers/services
 * can throw and have errorHandler.js respond with the right status instead of
 * a generic 500. Optional `details` (array of strings) is returned to the
 * client as `errors` — used for request-validation failures. Optional `errorCode` is returned as `code`.
 */
class ApiError extends Error {
  constructor(statusCode, message, details, errorCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    if (details) this.details = details;
    // Stable machine-readable identifier (e.g. "NO_ROUTE"); clients map it to friendly text. Named
    // errorCode (not `code`) so it can never collide with Mongo's numeric error.code (11000).
    if (errorCode) this.errorCode = errorCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
