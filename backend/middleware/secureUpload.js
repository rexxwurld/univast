/**
 * Upload pipeline for community submissions (PDF / photo / video).
 * Completely separate from middleware/upload.js (images -> Cloudinary).
 *
 *   multer (disk, random name, size cap)
 *     -> content sniffing: magic bytes must match extension AND declared MIME
 *     -> per-type size limit
 *     -> sha256 for duplicate detection
 *     -> quarantine: the file is NOT trusted application data until a moderator approves it
 */
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");
const ApiError = require("../utils/ApiError");
const { validateUpload, sanitizeFilename, getAllowedTypes } = require("../utils/fileSniff");
const { ensureQuarantineDir, removeKey } = require("../services/quarantineStorage");

const MAX_FILES_PER_REQUEST = 5;

function buildMulter() {
  const allowed = getAllowedTypes();
  const maxBytes = Math.max(...Object.values(allowed).map((t) => t.maxBytes));
  const allowedExtensions = new Set(Object.values(allowed).flatMap((t) => t.extensions));

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, ensureQuarantineDir());
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex")),
  });

  return multer({
    storage,
    limits: { fileSize: maxBytes, files: MAX_FILES_PER_REQUEST, fields: 10 },
    fileFilter: (req, file, cb) => {
      // Cheap early reject; the authoritative check is the content sniff below.
      const ext = (file.originalname.match(/\.[^.]+$/) || [""])[0].toLowerCase();
      if (!allowedExtensions.has(ext)) {
        return cb(new ApiError(400, `File type '${ext || "(none)"}' is not accepted`));
      }
      cb(null, true);
    },
  });
}

const sha256OfFile = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });

async function readHead(filePath, length = 32) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const cleanup = (files) => Promise.all((files || []).map((f) => removeKey(f.filename).catch(() => {})));

/** Step 1: receive files into quarantine (translates multer errors into clean API errors). */
function receiveFiles(req, res, next) {
  let upload;
  try {
    upload = buildMulter().array("files", MAX_FILES_PER_REQUEST);
  } catch (err) {
    return next(err);
  }
  upload(req, res, async (err) => {
    if (!err) return next();
    await cleanup(req.files);
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new ApiError(413, "File is too large"));
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return next(new ApiError(400, `Upload up to ${MAX_FILES_PER_REQUEST} files using the multipart field name 'files'`));
      }
      return next(new ApiError(400, `Upload error: ${err.message}`));
    }
    next(err);
  });
}

/** Step 2: verify content. Any failure deletes EVERY file of the request — all or nothing. */
async function verifyFiles(req, res, next) {
  try {
    if (!req.files || req.files.length === 0) throw new ApiError(400, "No files provided (multipart field 'files')");

    const verified = [];
    for (const file of req.files) {
      const headBytes = await readHead(file.path);
      const verdict = validateUpload({
        headBytes,
        originalName: file.originalname,
        declaredMime: file.mimetype,
        sizeBytes: file.size,
      });
      if (!verdict.ok) throw new ApiError(400, `${sanitizeFilename(file.originalname)}: ${verdict.reason}`);

      verified.push({
        storageKey: file.filename,
        originalName: sanitizeFilename(file.originalname),
        sniffedMime: verdict.mime,
        kind: verdict.kind,
        sizeBytes: file.size,
        sha256: await sha256OfFile(file.path),
      });
    }
    req.verifiedFiles = verified;
    next();
  } catch (err) {
    await cleanup(req.files);
    next(err);
  }
}

module.exports = { receiveFiles, verifyFiles, MAX_FILES_PER_REQUEST };
