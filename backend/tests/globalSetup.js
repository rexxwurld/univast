/**
 * Runs ONCE, before Jest starts its workers.
 *
 * mongodb-memory-server downloads a ~80 MB MongoDB binary the first time it runs. When every test file did that
 * on its own, several workers raced to download into the same folder: lock-file errors ("Cannot unlock file …"),
 * a half-written .tgz renamed away from under another worker (ENOENT), and the suites that lost the race timed
 * out. Fetching the binary here, once, means the workers only ever find it already in place.
 */
const path = require("path");
const { MongoBinary } = require("mongodb-memory-server");

module.exports = async () => {
  const downloadDir = process.env.MONGOMS_DOWNLOAD_DIR || path.resolve(__dirname, "../.mongodb-binaries");
  const version = process.env.MONGOMS_VERSION || "7.0.14";
  await MongoBinary.getPath({ downloadDir, version });
};
