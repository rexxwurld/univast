const mongoose = require("mongoose");

/**
 * Connects to MongoDB using MONGODB_URI. Fails loudly and stops the process
 * on any problem — a silently-unconnected app that "runs" but can't reach
 * its database is worse than one that refuses to start.
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error(
      "FATAL: MONGODB_URI is not set. Copy .env.example to .env and set MONGODB_URI."
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("FATAL: Error connecting to MongoDB:", error.message);
    process.exit(1);
  }
};

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected");
});

module.exports = connectDB;
