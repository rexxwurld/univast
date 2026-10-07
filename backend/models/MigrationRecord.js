const mongoose = require("mongoose");

// Bookkeeping for scripts/migrate.js — one row per applied data migration.
const migrationRecordSchema = new mongoose.Schema(
  { name: { type: String, required: true, unique: true }, appliedAt: { type: Date, default: Date.now }, summary: { type: Object, default: {} } },
  { versionKey: false }
);

module.exports = mongoose.model("MigrationRecord", migrationRecordSchema);
