/**
 * Lightweight MongoDB ObjectId format check.
 * Implemented as a regex so this module has zero dependency on mongoose
 * being installed/connected — it can be used anywhere (including tests).
 */
function isValidObjectId(id) {
  return typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
}

module.exports = { isValidObjectId };
