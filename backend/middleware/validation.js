const ApiError = require("../utils/ApiError");

/** Ensures each listed field is present and not an empty string. */
function validateRequiredFields(fields = []) {
  return function (req, res, next) {
    const missing = fields.filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || value === "";
    });

    if (missing.length > 0) {
      return next(new ApiError(400, `Missing required field(s): ${missing.join(", ")}`));
    }
    next();
  };
}

/**
 * Validates latitude/longitude on the request body.
 * By default both are required; pass { required: false } to allow them to
 * be omitted (e.g. on a partial PATCH), while still validating range if present.
 */
function validateLatLng({ required = true } = {}) {
  return function (req, res, next) {
    const { latitude, longitude } = req.body;

    for (const [field, value] of [["latitude", latitude], ["longitude", longitude]]) {
      if (value === undefined || value === null || value === "") {
        if (required) {
          return next(new ApiError(400, `${field} is required`));
        }
        continue;
      }
      if (typeof value !== "number" || Number.isNaN(value)) {
        return next(new ApiError(400, `${field} must be a number`));
      }
    }

    if (latitude !== undefined && latitude !== null && latitude !== "") {
      if (latitude < -90 || latitude > 90) {
        return next(new ApiError(400, "latitude must be between -90 and 90"));
      }
    }

    if (longitude !== undefined && longitude !== null && longitude !== "") {
      if (longitude < -180 || longitude > 180) {
        return next(new ApiError(400, "longitude must be between -180 and 180"));
      }
    }

    next();
  };
}

/** Validates a non-negative numeric distance field. */
function validateDistance({ field = "distance", required = true } = {}) {
  return function (req, res, next) {
    const value = req.body[field];

    if (value === undefined || value === null || value === "") {
      if (required) {
        return next(new ApiError(400, `${field} is required`));
      }
      return next();
    }

    if (typeof value !== "number" || Number.isNaN(value)) {
      return next(new ApiError(400, `${field} must be a number`));
    }

    if (value < 0) {
      return next(new ApiError(400, `${field} cannot be negative`));
    }

    next();
  };
}

/** Validates that a field, if present, is one of an allowed set of values. */
function validateEnumField(field, allowedValues, { required = false } = {}) {
  return function (req, res, next) {
    const value = req.body[field];

    if (value === undefined || value === null || value === "") {
      if (required) {
        return next(new ApiError(400, `${field} is required`));
      }
      return next();
    }

    if (!allowedValues.includes(value)) {
      return next(
        new ApiError(400, `${field} must be one of: ${allowedValues.join(", ")}`)
      );
    }

    next();
  };
}

/** Validates a boolean field if present (coerces nothing — must genuinely be a boolean). */
function validateBoolean(field, { required = false } = {}) {
  return function (req, res, next) {
    const value = req.body[field];

    if (value === undefined || value === null || value === "") {
      if (required) {
        return next(new ApiError(400, `${field} is required`));
      }
      return next();
    }

    if (typeof value !== "boolean") {
      return next(new ApiError(400, `${field} must be true or false`));
    }

    next();
  };
}

module.exports = {
  validateRequiredFields,
  validateLatLng,
  validateDistance,
  validateEnumField,
  validateBoolean,
};
