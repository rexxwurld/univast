const { isValidObjectId } = require("../utils/objectId");
const ApiError = require("../utils/ApiError");

/**
 * Validates a route param that must be a MongoDB ObjectId (e.g. :id).
 * Prevents malformed ids from reaching Mongoose and crashing the query
 * with an uncaught CastError.
 */
function validateObjectIdParam(paramName = "id") {
  return function (req, res, next) {
    const value = req.params[paramName];
    if (!isValidObjectId(value)) {
      return next(new ApiError(400, `Invalid ${paramName}: '${value}' is not a valid ObjectId`));
    }
    next();
  };
}

/**
 * Validates one or more ObjectId fields on the request body.
 * fields: array of field names, or { name, required } objects.
 */
function validateObjectIdBody(fields = []) {
  return function (req, res, next) {
    for (const field of fields) {
      const name = typeof field === "string" ? field : field.name;
      const required = typeof field === "string" ? true : field.required !== false;
      const value = req.body[name];

      if (value === undefined || value === null || value === "") {
        if (required) {
          return next(new ApiError(400, `${name} is required`));
        }
        continue;
      }

      if (!isValidObjectId(value)) {
        return next(new ApiError(400, `Invalid ${name}: '${value}' is not a valid ObjectId`));
      }
    }
    next();
  };
}

module.exports = { validateObjectIdParam, validateObjectIdBody };
