/**
 * Rebuilds `searchKeys` for every searchable model. Run after changing the rules in
 * utils/campusText.js, or after any bulk edit that bypassed document hooks.
 *   node scripts/reindexSearchKeys.js
 * Also exported for migrations/tests.
 */
const Building = require("../models/Building");
const Room = require("../models/Room");
const Landmark = require("../models/Landmark");
const Location = require("../models/Location");

async function reindexSearchKeys() {
  const counts = {};
  for (const Model of [Building, Room, Landmark, Location]) {
    let n = 0;
    for await (const doc of Model.find({})) {
      const keys = doc.computeSearchKeys();
      if (JSON.stringify(keys) !== JSON.stringify(doc.searchKeys)) {
        await Model.updateOne({ _id: doc._id }, { $set: { searchKeys: keys } });
        n += 1;
      }
    }
    counts[Model.modelName] = n;
  }
  return counts;
}

module.exports = { reindexSearchKeys };

if (require.main === module) {
  require("dotenv").config();
  const mongoose = require("mongoose");
  const connectDB = require("../config/database");
  connectDB()
    .then(reindexSearchKeys)
    .then((c) => { console.log("Reindexed:", c); return mongoose.disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
