const ApiError = require("../utils/ApiError");

/**
 * Validates req.body against a zod schema. On success, req.body is replaced
 * with the parsed (trimmed / unknown-keys-stripped) data. On failure responds
 * 400 with { message: <first problem>, errors: [<every problem>] }.
 */
function validateBody(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      // zod's default for a missing field is the unhelpful "Required".
      const messages = result.error.issues.map((i) =>
        i.message === "Required" && i.path.length ? `${i.path.join(".")} is required` : i.message
      );
      const details = result.error.issues.map((i, idx) =>
        i.path.length ? `${i.path.join(".")}: ${messages[idx]}` : messages[idx]
      );
      return next(new ApiError(400, messages[0], details));
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };
