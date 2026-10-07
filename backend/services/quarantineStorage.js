/**
 * Where untrusted uploads live. Rules:
 *  - a directory that is NOT served by Express (there is no static middleware) and, in
 *    production, must be configured explicitly (UPLOAD_QUARANTINE_DIR);
 *  - files are stored under a random 32-hex name with NO extension, mode 0600, so
 *    nothing user-controlled ever reaches the filesystem path and nothing is executable;
 *  - bytes are only ever read back through the authorized download controller.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const ApiError = require("../utils/ApiError");

const KEY_PATTERN = /^[a-f0-9]{32}$/;

function getQuarantineDir() {
  const configured = process.env.UPLOAD_QUARANTINE_DIR;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new ApiError(503, "File uploads are not configured on this server (UPLOAD_QUARANTINE_DIR is not set)");
  }
  return configured || path.join(os.tmpdir(), "univast-quarantine");
}

function ensureQuarantineDir() {
  const dir = getQuarantineDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function pathForKey(key) {
  if (!KEY_PATTERN.test(String(key))) throw new ApiError(400, "Invalid storage key");
  return path.join(getQuarantineDir(), key);
}

async function removeKey(key) {
  try {
    await fs.promises.unlink(pathForKey(key));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

module.exports = { getQuarantineDir, ensureQuarantineDir, pathForKey, removeKey, KEY_PATTERN };
