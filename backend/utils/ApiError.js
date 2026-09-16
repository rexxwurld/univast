/**
 * Operational error with an explicit HTTP status code, so controllers/services
 * can throw and have errorHandler.js respond with the right status instead of
 * a generic 500.
 */
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
