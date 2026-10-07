const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser, registerAdmin, registerWithRole } = require("./fixtures");

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

describe("roles", () => {
  it("keeps the original roles and adds moderator + campus_coordinator in the ONE role system", () => {
    expect(User.ROLES).toEqual(["user", "business", "admin", "moderator", "campus_coordinator"]);
  });

  it("lets an admin assign the new roles", async () => {
    const admin = await registerAdmin();
    const target = await registerUser();
    for (const role of ["moderator", "campus_coordinator"]) {
      const res = await request(app).patch(`/api/v1/admin/users/${target.user.id}/role`).set(auth(admin.token)).send({ role });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(role);
    }
    const bad = await request(app).patch(`/api/v1/admin/users/${target.user.id}/role`).set(auth(admin.token)).send({ role: "superuser" });
    expect(bad.status).toBe(400);
  });

  it("does not let a user promote themselves or anyone else", async () => {
    const user = await registerUser();
    const res = await request(app).patch(`/api/v1/admin/users/${user.user.id}/role`).set(auth(user.token)).send({ role: "admin" });
    expect(res.status).toBe(403);
    expect((await User.findById(user.user.id)).role).toBe("user");
  });

  it("registration cannot smuggle a role", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({ name: "Sneaky", email: "sneaky@example.com", password: "password123", role: "admin" });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("user");
  });

  it("registration cannot smuggle campusIds either", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Sneaky", email: "sneaky2@example.com", password: "password123", campusIds: ["507f1f77bcf86cd799439011"] });
    expect(res.status).toBe(201);
    const stored = await User.findOne({ email: "sneaky2@example.com" });
    expect(stored.campusIds).toHaveLength(0);
  });

  it("the admin dashboard endpoints stay admin-only (moderator / coordinator are NOT admins)", async () => {
    for (const role of ["moderator", "campus_coordinator"]) {
      const { token } = await registerWithRole(role);
      expect((await request(app).get("/api/v1/admin/stats").set(auth(token))).status).toBe(403);
      expect((await request(app).get("/api/v1/admin/users").set(auth(token))).status).toBe(403);
    }
  });

  it("legacy campus-nav writes remain admin-only (coordinator access arrives with the mapping tool)", async () => {
    const { token } = await registerWithRole("campus_coordinator");
    const res = await request(app).post("/api/v1/universities").set(auth(token)).send({ name: "U", ShortName: "U", country: "X", state: "Y" });
    expect(res.status).toBe(403);
  });

  it("a role change takes effect immediately (role is read from the DB on each request)", async () => {
    const { token, user } = await registerUser();
    expect((await request(app).get("/api/v1/admin/stats").set(auth(token))).status).toBe(403);
    await User.findByIdAndUpdate(user.id, { role: "admin" });
    expect((await request(app).get("/api/v1/admin/stats").set(auth(token))).status).toBe(200);
  });
});
