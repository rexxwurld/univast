/**
 *   node scripts/devFixture.js seed [--publish]
 *   node scripts/devFixture.js remove [--force]
 * Refuses to seed in production unless ALLOW_DEV_FIXTURE=true.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/database");
const { seedDevFixture, removeDevFixture } = require("../seeds/devFixture");

const [command] = process.argv.slice(2);
const has = (flag) => process.argv.includes(flag);

(async () => {
  if (command === "seed" && process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_FIXTURE !== "true") {
    throw new Error("Refusing to seed DEV_FIXTURE in production (set ALLOW_DEV_FIXTURE=true to override).");
  }
  await connectDB();
  if (command === "seed") console.log(await seedDevFixture({ publish: has("--publish") }));
  else if (command === "remove") console.log(await removeDevFixture({ force: has("--force") }));
  else throw new Error("Usage: node scripts/devFixture.js seed [--publish] | remove [--force]");
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
