const path = require("path");
const { MongoBinary } = require("mongodb-memory-server");

module.exports = async () => {
  const downloadDir = process.env.MONGOMS_DOWNLOAD_DIR || path.resolve(__dirname, "../.mongodb-binaries");
  const version = process.env.MONGOMS_VERSION || "7.0.14";
  await MongoBinary.getPath({ downloadDir, version });
};
