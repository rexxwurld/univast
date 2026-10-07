const request = require("supertest");
const app = require("../app");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser } = require("./fixtures");

beforeAll(async () => {
  await connect();
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
});
afterEach(async () => {
  await clearDatabase();
});
afterAll(async () => {
  await closeDatabase();
});

describe("POST /api/v1/uploads/image", () => {
  it("requires auth", async () => {
    const res = await request(app)
      .post("/api/v1/uploads/image")
      .attach("image", Buffer.from("x"), { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("rejects non-image file types", async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post("/api/v1/uploads/image")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", Buffer.from("echo hi"), { filename: "evil.sh", contentType: "text/x-shellscript" });
    expect(res.status).toBe(400);
  });

  it("returns 503 (not a crash) when Cloudinary is not configured", async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post("/api/v1/uploads/image")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", Buffer.from("x"), { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(503);
  });
});
