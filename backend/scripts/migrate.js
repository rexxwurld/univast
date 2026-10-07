/**
 * Minimal data-migration runner (Mongoose has no built-in one).
 *   node scripts/migrate.js            dry run — reports what WOULD change, writes nothing
 *   node scripts/migrate.js --apply    applies pending migrations in filename order
 * Applied migrations are recorded in the MigrationRecord collection, so re-running is safe.
 * Every migration must itself be idempotent and additive.
 */
const fs = require("fs");
const path = require("path");
const MigrationRecord = require("../models/MigrationRecord");

async function runMigrations({ dryRun = true, dir = path.join(__dirname, "migrations") } = {}) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
  const results = [];
  for (const file of files) {
    const migration = require(path.join(dir, file));
    const done = await MigrationRecord.findOne({ name: migration.name });
    if (done) {
      results.push({ name: migration.name, status: "already_applied" });
      continue;
    }
    const summary = await migration.up({ dryRun });
    if (!dryRun) await MigrationRecord.create({ name: migration.name, summary });
    results.push({ name: migration.name, status: dryRun ? "would_apply" : "applied", summary });
  }
  return results;
}

module.exports = { runMigrations };

if (require.main === module) {
  require("dotenv").config();
  const mongoose = require("mongoose");
  const connectDB = require("../config/database");
  const apply = process.argv.includes("--apply");
  connectDB()
    .then(() => runMigrations({ dryRun: !apply }))
    .then((r) => { console.log(JSON.stringify(r, null, 2)); if (!apply) console.log("\nDry run. Re-run with --apply to write."); return mongoose.disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
