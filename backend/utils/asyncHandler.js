/**
 * Wraps an async route/controller function so any rejected promise or
 * thrown error is forwarded to Express's centralized error handler
 * instead of crashing the process or hanging the request.
 */
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
