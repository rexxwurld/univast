const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
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

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe("Admin API", () => {
  it("rejects anonymous and non-admin access to every admin route", async () => {
    const { token, user } = await registerUser();

    for (const path of ["/api/v1/admin/users", "/api/v1/admin/stats"]) {
      expect((await request(app).get(path)).status).toBe(401);
      expect((await request(app).get(path).set(auth(token))).status).toBe(403);
    }

    const res = await request(app).patch(`/api/v1/admin/users/${user.id}/role`).set(auth(token)).send({ role: "admin" });
    expect(res.status).toBe(403);
  });

  it("cannot be used for self-promotion via the public register endpoint", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Sneaky", email: "sneaky@example.com", password: "password123", role: "admin" });
    expect(res.status).toBe(201);
    const dbUser = await User.findOne({ email: "sneaky@example.com" });
    expect(dbUser.role).toBe("user");
  });

  it("lists users with pagination and a role filter", async () => {
    const { token } = await registerAdmin();
    await registerUser();
    await registerUser();

    const all = await request(app).get("/api/v1/admin/users").set(auth(token));
    expect(all.status).toBe(200);
    expect(all.body.pagination.total).toBe(3);

    const admins = await request(app).get("/api/v1/admin/users?role=admin").set(auth(token));
    expect(admins.body.data).toHaveLength(1);

    const paged = await request(app).get("/api/v1/admin/users?limit=2&page=2").set(auth(token));
    expect(paged.body.data).toHaveLength(1);
  });

  it("changes a user's role, and rejects invalid roles", async () => {
    const { token } = await registerAdmin();
    const { user } = await registerUser();

    const ok = await request(app).patch(`/api/v1/admin/users/${user.id}/role`).set(auth(token)).send({ role: "business" });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("business");

    const bad = await request(app).patch(`/api/v1/admin/users/${user.id}/role`).set(auth(token)).send({ role: "emperor" });
    expect(bad.status).toBe(400);
  });

  it("returns 404 when changing the role of a user that does not exist", async () => {
    const { token } = await registerAdmin();
    const res = await request(app)
      .patch("/api/v1/admin/users/507f1f77bcf86cd799439011/role")
      .set(auth(token))
      .send({ role: "user" });
    expect(res.status).toBe(404);
  });

  it("returns platform stats", async () => {
    const { token } = await registerAdmin();
    await registerUser();

    const res = await request(app).get("/api/v1/admin/stats").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: 2, places: 0, reviews: 0, businesses: 0, pendingReports: 0 });
  });
});
