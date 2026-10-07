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

describe("Categories", () => {
  it("lists categories without auth", async () => {
    const res = await request(app).get("/api/v1/categories");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("rejects category creation with no auth", async () => {
    const res = await request(app).post("/api/v1/categories").send({ name: "Restaurant" });
    expect(res.status).toBe(401);
  });

  it("rejects category creation from a non-admin user", async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Restaurant" });
    expect(res.status).toBe(403);
  });

  it("allows category creation from an admin", async () => {
    const { token } = await registerAdmin();
    const res = await request(app)
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Restaurant" });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("restaurant");
  });
});
