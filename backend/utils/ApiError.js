/**
 * Operational error with an explicit HTTP status code, so controllers/services
 * can throw and have errorHandler.js respond with the right status instead of
 * a generic 500. Optional `details` (array of strings) is returned to the
 * client as `errors` — used for request-validation failures.
 */
class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
