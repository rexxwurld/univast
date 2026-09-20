const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

/**
 * Starts a real, temporary, in-memory MongoDB instance and connects Mongoose
 * to it. Completely isolated from any real database — nothing here can ever
 * touch a production MONGODB_URI, even by accident.
 *
 * Note: mongodb-memory-server downloads a real MongoDB binary the first time
 * it runs (cached afterward), so the first `npm test` needs internet access.
 */
async function connect() {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
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
