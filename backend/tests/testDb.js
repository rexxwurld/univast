const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

function resetMongoBinaryCache() {
  const downloadDir = process.env.MONGOMS_DOWNLOAD_DIR || path.resolve(__dirname, "../.mongodb-binaries");

  if (!fs.existsSync(downloadDir)) {
    return;
  }

  for (const entry of fs.readdirSync(downloadDir)) {
    if (
      entry.endsWith(".lock") ||
      entry.endsWith(".downloading") ||
      entry.endsWith(".zip") ||
      entry.endsWith(".partial") ||
      entry.endsWith(".tmp")
    ) {
      fs.rmSync(path.join(downloadDir, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Starts a real, temporary, in-memory MongoDB instance and connects Mongoose
 * to it. Completely isolated from any real database — nothing here can ever
 * touch a production MONGODB_URI, even by accident.
 *
 * Note: mongodb-memory-server downloads a real MongoDB binary the first time
 * it runs (cached afterward), so the first `npm test` needs internet access.
 * We pin the binary version to avoid upstream MD5 mismatch issues during CI runs.
 */
async function connect() {
  const downloadDir = process.env.MONGOMS_DOWNLOAD_DIR || path.resolve(__dirname, "../.mongodb-binaries");

  if (mongoose.connection.readyState === 1 && mongoServer) {
    return;
  }

  resetMongoBinaryCache();

  mongoServer = await MongoMemoryServer.create({
    binary: {
      version: process.env.MONGOMS_VERSION || "7.0.14",
    },
    downloadDir,
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });

  await mongoose.connect(mongoServer.getUri("test"));
  // Make sure every unique index exists before the first test relies on it (autoIndex is async).
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

async function closeDatabase() {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
}

/** Call between tests to reset state without paying the cost of a fresh server. */
async function clearDatabase() {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

module.exports = { connect, closeDatabase, clearDatabase };
