const request = require("supertest");
const app = require("../app");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser, registerAdmin } = require("./fixtures");

beforeAll(async () => {
  await connect();
});
afterEach(async () => {
  await clearDatabase();
});
afterAll(async () => {
  await closeDatabase();
});

const university = { name: "Test University", ShortName: "TU", country: "Nigeria", state: "Cross River" };

describe("Legacy campus-navigation routes: writes are admin-only", () => {
  it("still allows anonymous reads", async () => {
    const res = await request(app).get("/api/v1/universities");
    expect(res.status).toBe(200);
  });

  it("rejects an anonymous write with 401", async () => {
    const res = await request(app).post("/api/v1/universities").send(university);
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin write with 403", async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post("/api/v1/universities")
      .set("Authorization", `Bearer ${token}`)
      .send(university);
    expect(res.status).toBe(403);
  });

  it("allows an admin write", async () => {
    const { token } = await registerAdmin();
    const res = await request(app)
      .post("/api/v1/universities")
      .set("Authorization", `Bearer ${token}`)
      .send(university);
    expect(res.status).toBe(201);
  });

  it("rejects an anonymous delete", async () => {
    const res = await request(app).delete("/api/v1/campuses/507f1f77bcf86cd799439011");
    expect(res.status).toBe(401);
  });

  it("keeps the routing endpoints public (they only read)", async () => {
    // Body is deliberately invalid: we only care that auth doesn't block it (expect 400, not 401).
    const res = await request(app).post("/api/v1/routes/route").send({});
    expect(res.status).toBe(400);
  });
});
