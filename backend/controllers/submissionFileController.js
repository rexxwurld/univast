const fs = require("fs");
const UploadedFile = require("../models/UploadedFile");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { pathForKey, removeKey } = require("../services/quarantineStorage");

const REVIEW_ROLES = ["admin", "moderator"];

const publicFile = (f, extra = {}) => ({
  id: String(f._id),
  originalName: f.originalName,
  mimeType: f.sniffedMime,
  kind: f.kind,
  sizeBytes: f.sizeBytes,
  status: f.status,
  createdAt: f.createdAt,
  ...extra,
});

/** POST /api/v1/submission-files — multipart field "files". Everything lands in quarantine. */
const upload = asyncHandler(async (req, res) => {
  const out = [];
  const created = [];
  try {
    for (const file of req.verifiedFiles) {
      // Same owner re-uploading identical bytes: keep one copy, don't store it twice.
      const existing = await UploadedFile.findOne({ ownerId: req.user.id, sha256: file.sha256, status: { $ne: "deleted" } });
      if (existing) {
        await removeKey(file.storageKey);
        out.push(publicFile(existing, { duplicate: true }));
        continue;
      }
      const doc = await UploadedFile.create({ ...file, ownerId: req.user.id, status: "quarantined" });
      created.push(doc);
      out.push(publicFile(doc, { duplicate: false }));
    }
  } catch (err) {
    await Promise.all(req.verifiedFiles.map((f) => removeKey(f.storageKey).catch(() => {})));
    await UploadedFile.deleteMany({ _id: { $in: created.map((d) => d._id) } });
    throw err;
  }
  res.status(201).json({ files: out });
});

/** GET /api/v1/submission-files — the caller's own uploads. */
const listMine = asyncHandler(async (req, res) => {
  const files = await UploadedFile.find({ ownerId: req.user.id, status: { $ne: "deleted" } }).sort({ createdAt: -1 }).limit(100);
  res.status(200).json(files.map((f) => publicFile(f)));
});

/**
 * GET /api/v1/submission-files/:id/download — owner, moderator or admin only.
 * Served as an attachment with nosniff + a sandboxing CSP, so even a file that slipped
 * through (e.g. a polyglot PDF) cannot run script in the browser.
 */
const download = asyncHandler(async (req, res) => {
  const file = await UploadedFile.findById(req.params.id);
  // Same 404 for "missing" and "not yours" so ids can't be probed.
  if (!file || file.status === "deleted") throw new ApiError(404, "File not found");
  const isOwner = String(file.ownerId) === req.user.id;
  if (!isOwner && !REVIEW_ROLES.includes(req.user.role)) throw new ApiError(404, "File not found");

  const filePath = pathForKey(file.storageKey);
  try {
    await fs.promises.access(filePath);
  } catch {
    throw new ApiError(404, "File not found");
  }

  res.set({
    "Content-Type": file.sniffedMime,
    "Content-Disposition": `attachment; filename="${file.originalName.replace(/"/g, "")}"`,
    "Content-Length": String(file.sizeBytes),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
  });
  fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
});

module.exports = { upload, listMine, download };
