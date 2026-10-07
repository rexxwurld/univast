/**
 * Content sniffing for community submissions. Pure — works on a Buffer of the
 * first bytes of a file. We NEVER trust the client-declared MIME type or the
 * file extension on their own: the real type is decided from magic bytes, and
 * must agree with both.
 */
const path = require("path");

const MB = 1024 * 1024;

// One entry per accepted type. Limits are defaults; override with UPLOAD_MAX_*_MB env vars.
const envMb = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

function getAllowedTypes() {
  return {
    "image/jpeg": { extensions: [".jpg", ".jpeg"], maxBytes: envMb("UPLOAD_MAX_IMAGE_MB", 10) * MB, kind: "image" },
    "image/png": { extensions: [".png"], maxBytes: envMb("UPLOAD_MAX_IMAGE_MB", 10) * MB, kind: "image" },
    "image/webp": { extensions: [".webp"], maxBytes: envMb("UPLOAD_MAX_IMAGE_MB", 10) * MB, kind: "image" },
    "application/pdf": { extensions: [".pdf"], maxBytes: envMb("UPLOAD_MAX_PDF_MB", 25) * MB, kind: "document" },
    "video/mp4": { extensions: [".mp4"], maxBytes: envMb("UPLOAD_MAX_VIDEO_MB", 100) * MB, kind: "video" },
    "video/quicktime": { extensions: [".mov"], maxBytes: envMb("UPLOAD_MAX_VIDEO_MB", 100) * MB, kind: "video" },
  };
}

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/** Returns the real MIME type from magic bytes, or null if unrecognised. */
function sniffMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  // "%PDF-" may be preceded by a few junk bytes in the wild; accept within the first 1024 only if at offset 0 here (strict).
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  // ISO base media: bytes 4..7 == "ftyp"; brand decides mp4 vs quicktime.
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.toString("ascii", 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  return null;
}

/** Strips directories and unsafe characters; the result is only ever used as display metadata. */
function sanitizeFilename(name) {
  const base = path.basename(String(name || "file")).replace(/[^\w.\- ()]/g, "_").replace(/\.{2,}/g, ".");
  return base.slice(0, 120) || "file";
}

/**
 * Decides whether an uploaded file is acceptable.
 * @returns { ok:true, mime, kind } | { ok:false, reason }
 */
function validateUpload({ headBytes, originalName, declaredMime, sizeBytes }) {
  const allowed = getAllowedTypes();
  const sniffed = sniffMime(headBytes);
  if (!sniffed || !allowed[sniffed]) {
    return { ok: false, reason: "File content is not a supported type (JPEG, PNG, WebP, PDF, MP4 or MOV)" };
  }
  const rule = allowed[sniffed];

  const ext = path.extname(String(originalName || "")).toLowerCase();
  if (!rule.extensions.includes(ext)) {
    return { ok: false, reason: `File extension '${ext || "(none)"}' does not match its content (${sniffed})` };
  }
  if (declaredMime && declaredMime !== sniffed && declaredMime !== "application/octet-stream") {
    return { ok: false, reason: `Declared type '${declaredMime}' does not match file content (${sniffed})` };
  }
  if (sizeBytes > rule.maxBytes) {
    return { ok: false, reason: `File is too large for ${sniffed} (max ${Math.round(rule.maxBytes / MB)}MB)` };
  }
  return { ok: true, mime: sniffed, kind: rule.kind };
}

module.exports = { sniffMime, sanitizeFilename, validateUpload, getAllowedTypes };
