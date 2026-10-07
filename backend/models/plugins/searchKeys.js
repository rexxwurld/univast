const { buildKeys } = require("../../utils/campusText");

/**
 * Adds an indexed `searchKeys` array (canonical normalized names/aliases) that is
 * rebuilt on every save()/create(). NOTE: updateOne/findOneAndUpdate bypass
 * document hooks — always edit through doc.save(), or run
 * scripts/reindexSearchKeys.js afterwards.
 *
 * options.fields       single-value string paths to include (e.g. ["name","roomNumber"])
 * options.arrayFields  array-of-string paths to include (default ["aliases"])
 */
module.exports = function searchKeysPlugin(schema, { fields = ["name"], arrayFields = ["aliases"] } = {}) {
  schema.add({ searchKeys: { type: [String], default: [], index: true } });

  schema.methods.computeSearchKeys = function computeSearchKeys() {
    const values = [];
    for (const f of fields) values.push(this.get(f));
    for (const f of arrayFields) values.push(...(this.get(f) || []));
    return buildKeys(values);
  };

  schema.pre("validate", async function rebuildSearchKeys() {
    this.searchKeys = this.computeSearchKeys();
  });
};
