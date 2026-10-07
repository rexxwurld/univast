const fs = require("fs");
const os = require("os");
const path = require("path");

// Must be set before any request is made (read at call time by services/quarantineStorage.js).
const QUARANTINE = fs.mkdtempSync(path.join(os.tmpdir(), "univast-test-quarantine-"));
process.env.UPLOAD_QUARANTINE_DIR = QUARANTINE;

const request = require("supertest");
const app = require("../app");
const UploadedFile = require("../models/UploadedFile");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser, registerWithRole } = require("./fixtures");

beforeAll(async () => {
  await connect();
});
afterEach(async () => {
  await clearDatabase();
  for (const f of fs.readdirSync(QUARANTINE)) fs.unlinkSync(path.join(QUARANTINE, f));
});
afterAll(async () => {
  await closeDatabase();
  fs.rmSync(QUARANTINE, { recursive: true, force: true });
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const stored = () => fs.readdirSync(QUARANTINE);

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n% survey"), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64)]);
const PHP = Buffer.from("<?php system($_GET['c']); ?>" + " ".repeat(40));

const upload = (token, files) => {
  let req = request(app).post("/api/v1/submission-files");
  if (token) req = req.set(auth(token));
  for (const [buffer, filename, contentType] of files) req = req.attach("files", buffer, { filename, contentType });
  return req;
};

describe("POST /api/v1/submission-files", () => {
  it("requires authentication and writes nothing for anonymous callers", async () => {
    const res = await upload(null, [[PDF, "survey.pdf", "application/pdf"]]);
    expect(res.status).toBe(401);
    expect(stored()).toHaveLength(0);
  });

  it("accepts a PDF, photo and video into quarantine with random extension-less names", async () => {
    const { token } = await registerUser();
    const res = await upload(token, [
      [PDF, "survey.pdf", "application/pdf"],
      [PNG, "gate.png", "image/png"],
      [MP4, "walk.mp4", "video/mp4"],
    ]);
    expect(res.status).toBe(201);
    expect(res.body.files.map((f) => f.kind).sort()).toEqual(["document", "image", "video"]);
    expect(res.body.files.every((f) => f.status === "quarantined")).toBe(true);

    const names = stored();
    expect(names).toHaveLength(3);
    for (const n of names) {
      expect(n).toMatch(/^[a-f0-9]{32}$/); // random, no extension, nothing user-controlled
      expect(fs.statSync(path.join(QUARANTINE, n)).mode & 0o111).toBe(0); // not executable
    }
    const docs = await UploadedFile.find({});
    expect(docs.every((d) => d.status === "quarantined")).toBe(true);
    expect(docs[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never exposes the storage key or path in the response", async () => {
    const { token } = await registerUser();
    const res = await upload(token, [[PDF, "survey.pdf", "application/pdf"]]);
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey|univast-test-quarantine/);
  });

  it("rejects a PHP script disguised as a PDF and stores nothing", async () => {
    const { token } = await registerUser();
    const res = await upload(token, [[PHP, "survey.pdf", "application/pdf"]]);
    expect(res.status).toBe(400);
    expect(stored()).toHaveLength(0);
    expect(await UploadedFile.countDocuments({})).toBe(0);
  });

  it("rejects content/extension mismatches and disallowed extensions", async () => {
    const { token } = await registerUser();
    expect((await upload(token, [[PNG, "map.pdf", "application/pdf"]])).status).toBe(400);
    expect((await upload(token, [[PDF, "evil.php", "application/pdf"]])).status).toBe(400);
    expect((await upload(token, [[PDF, "evil.pdf.exe", "application/octet-stream"]])).status).toBe(400);
    expect(stored()).toHaveLength(0);
  });

  it("is all-or-nothing: one bad file rejects the whole request and cleans up the good ones", async () => {
    const { token } = await registerUser();
    const res = await upload(token, [
      [PDF, "survey.pdf", "application/pdf"],
      [PHP, "photo.png", "image/png"],
    ]);
    expect(res.status).toBe(400);
    expect(stored()).toHaveLength(0);
  });

  it("enforces per-type size limits", async () => {
    const { token } = await registerUser();
    const previous = process.env.UPLOAD_MAX_PDF_MB;
    process.env.UPLOAD_MAX_PDF_MB = "0.0001"; // ~100 bytes
    try {
      const big = Buffer.concat([PDF, Buffer.alloc(500)]);
      const res = await upload(token, [[big, "big.pdf", "application/pdf"]]);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/too large/);
      expect(stored()).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.UPLOAD_MAX_PDF_MB;
      else process.env.UPLOAD_MAX_PDF_MB = previous;
    }
  });

  it("limits the number of files per request and the field name", async () => {
    const { token } = await registerUser();
    const many = Array.from({ length: 6 }, (_, i) => [PDF, `f${i}.pdf`, "application/pdf"]);
    expect((await upload(token, many)).status).toBe(400);
    const wrongField = await request(app).post("/api/v1/submission-files").set(auth(token)).attach("document", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    expect(wrongField.status).toBe(400);
    expect(stored()).toHaveLength(0);
  });

  it("de-duplicates identical bytes from the same user (anti-farming) but not across users", async () => {
    const a = await registerUser();
    const b = await registerUser();
    const first = await upload(a.token, [[PDF, "survey.pdf", "application/pdf"]]);
    const again = await upload(a.token, [[PDF, "survey-copy.pdf", "application/pdf"]]);
    expect(again.status).toBe(201);
    expect(again.body.files[0].duplicate).toBe(true);
    expect(again.body.files[0].id).toBe(first.body.files[0].id);
    expect(stored()).toHaveLength(1);
    expect(await UploadedFile.countDocuments({})).toBe(1);

    const other = await upload(b.token, [[PDF, "survey.pdf", "application/pdf"]]);
    expect(other.body.files[0].duplicate).toBe(false);
    expect(await UploadedFile.countDocuments({})).toBe(2);
  });

  it("sanitizes the stored display name", async () => {
    const { token } = await registerUser();
    const res = await upload(token, [[PDF, "../../etc/<script>.pdf", "application/pdf"]]);
    expect(res.status).toBe(201);
    expect(res.body.files[0].originalName).not.toMatch(/[\/<>]/);
  });
});

describe("listing and safe download", () => {
  it("lists only the caller's own files", async () => {
    const a = await registerUser();
    const b = await registerUser();
    await upload(a.token, [[PDF, "a.pdf", "application/pdf"]]);
    await upload(b.token, [[PNG, "b.png", "image/png"]]);
    const res = await request(app).get("/api/v1/submission-files").set(auth(a.token));
    expect(res.body).toHaveLength(1);
    expect(res.body[0].originalName).toBe("a.pdf");
  });

  it("serves the owner an attachment with nosniff + sandbox headers and the sniffed type", async () => {
    const { token } = await registerUser();
    const up = await upload(token, [[PDF, "survey.pdf", "application/pdf"]]);
    const res = await request(app).get(`/api/v1/submission-files/${up.body.files[0].id}/download`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toMatch(/sandbox/);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  it("lets moderators and admins download, but returns 404 (not 403) to other users and 401 to anonymous", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const moderator = await registerWithRole("moderator");
    const admin = await registerWithRole("admin");
    const up = await upload(owner.token, [[PDF, "survey.pdf", "application/pdf"]]);
    const dl = (token) => {
      const r = request(app).get(`/api/v1/submission-files/${up.body.files[0].id}/download`);
      return token ? r.set(auth(token)) : r;
    };
    expect((await dl(moderator.token)).status).toBe(200);
    expect((await dl(admin.token)).status).toBe(200);
    expect((await dl(stranger.token)).status).toBe(404);
    expect((await dl(null)).status).toBe(401);
  });

  it("404s a record whose bytes are gone and validates the id", async () => {
    const { token } = await registerUser();
    const up = await upload(token, [[PDF, "survey.pdf", "application/pdf"]]);
    for (const n of stored()) fs.unlinkSync(path.join(QUARANTINE, n));
    expect((await request(app).get(`/api/v1/submission-files/${up.body.files[0].id}/download`).set(auth(token))).status).toBe(404);
    expect((await request(app).get("/api/v1/submission-files/not-an-id/download").set(auth(token))).status).toBe(400);
  });

  it("a deleted record can't be downloaded", async () => {
    const { token } = await registerUser();
    const up = await upload(token, [[PDF, "survey.pdf", "application/pdf"]]);
    await UploadedFile.updateOne({ _id: up.body.files[0].id }, { status: "deleted" });
    expect((await request(app).get(`/api/v1/submission-files/${up.body.files[0].id}/download`).set(auth(token))).status).toBe(404);
  });
});

describe("the existing Cloudinary image endpoint is untouched", () => {
  it("still rejects a PDF on /uploads/image", async () => {
    const { token } = await registerUser();
    const res = await request(app).post("/api/v1/uploads/image").set(auth(token)).attach("image", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });
});
