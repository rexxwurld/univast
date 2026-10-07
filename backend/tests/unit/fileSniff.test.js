const { sniffMime, sanitizeFilename, validateUpload } = require("../../utils/fileSniff");

const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(32)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(40)]);
const SCRIPT = Buffer.from("<?php system($_GET['c']); ?>                  ");

describe("sniffMime", () => {
  it("recognises supported formats by magic bytes", () => {
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(MP4)).toBe("video/mp4");
    expect(sniffMime(MOV)).toBe("video/quicktime");
    expect(sniffMime(WEBP)).toBe("image/webp");
  });
  it("rejects executables, scripts and tiny buffers", () => {
    expect(sniffMime(EXE)).toBeNull();
    expect(sniffMime(SCRIPT)).toBeNull();
    expect(sniffMime(Buffer.from("abc"))).toBeNull();
    expect(sniffMime(null)).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a consistent file", () => {
    expect(validateUpload({ headBytes: PDF, originalName: "survey.pdf", declaredMime: "application/pdf", sizeBytes: 1000 })).toEqual({ ok: true, mime: "application/pdf", kind: "document" });
  });
  it("rejects a script renamed to .jpg", () => {
    expect(validateUpload({ headBytes: SCRIPT, originalName: "photo.jpg", declaredMime: "image/jpeg", sizeBytes: 50 }).ok).toBe(false);
  });
  it("rejects when the extension disagrees with the content", () => {
    const r = validateUpload({ headBytes: PNG, originalName: "map.pdf", declaredMime: "application/pdf", sizeBytes: 50 });
    expect(r.ok).toBe(false);
  });
  it("rejects when the declared MIME disagrees with the content", () => {
    const r = validateUpload({ headBytes: JPEG, originalName: "a.jpg", declaredMime: "application/pdf", sizeBytes: 50 });
    expect(r.ok).toBe(false);
  });
  it("accepts a generic octet-stream declaration if content and extension agree", () => {
    expect(validateUpload({ headBytes: JPEG, originalName: "a.JPG", declaredMime: "application/octet-stream", sizeBytes: 50 }).ok).toBe(true);
  });
  it("enforces per-type size limits", () => {
    expect(validateUpload({ headBytes: JPEG, originalName: "a.jpg", declaredMime: "image/jpeg", sizeBytes: 11 * 1024 * 1024 }).ok).toBe(false);
    expect(validateUpload({ headBytes: MP4, originalName: "a.mp4", declaredMime: "video/mp4", sizeBytes: 50 * 1024 * 1024 }).ok).toBe(true);
  });
  it("rejects double extensions that end in a disallowed one", () => {
    expect(validateUpload({ headBytes: JPEG, originalName: "a.jpg.php", declaredMime: "image/jpeg", sizeBytes: 50 }).ok).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("strips paths and odd characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a<b>c|d.pdf")).toBe("a_b_c_d.pdf");
    expect(sanitizeFilename("")).toBe("file");
  });
});
