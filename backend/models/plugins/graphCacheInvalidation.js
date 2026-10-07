/**
 * Drops the cached routing graph whenever navigation nodes/edges are written through Mongoose.
 * (Other server instances rely on the cache's short TTL; the graph version in every route response also
 * changes whenever the data does.) services/graphCache is required lazily to avoid a require cycle.
 */
module.exports = function graphCacheInvalidation(schema) {
  const invalidate = (campusId) => require("../../services/graphCache").invalidate(campusId);

  schema.post("save", function afterSave(doc) {
    invalidate(doc && doc.campusId);
  });
  schema.post("deleteOne", { document: true, query: false }, function afterDocDelete(doc) {
    invalidate(doc && doc.campusId);
  });
  // Query-style writes don't expose the campus, so clear everything (cheap: one entry per campus).
  schema.post(
    ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany"],
    { document: false, query: true },
    function afterQueryWrite() {
      invalidate();
    }
  );
  schema.post("insertMany", function afterInsertMany() {
    invalidate();
  });
};
