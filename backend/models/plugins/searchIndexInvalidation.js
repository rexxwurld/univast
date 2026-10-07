/**
 * Drops the cached global-search candidate list whenever searchable data is written through Mongoose
 * (universities, campuses, buildings, rooms, landmarks, places, categories, aliases).
 * Other server instances, raw driver writes and scripts rely on the cache's short TTL
 * (GLOBAL_SEARCH_CACHE_SECONDS). services/globalSearchCache is required lazily to avoid a require cycle.
 */
module.exports = function searchIndexInvalidation(schema) {
  const invalidate = () => require("../../services/globalSearchCache").invalidate();

  schema.post("save", invalidate);
  schema.post("deleteOne", { document: true, query: false }, invalidate);
  schema.post(
    ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany"],
    { document: false, query: true },
    invalidate
  );
  schema.post("insertMany", invalidate);
  schema.post("bulkWrite", invalidate);
};
