const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
const Category = require("../models/Category");

let counter = 0;
/** Unique email per call so tests never collide on the User.email unique index. */
function uniqueEmail() {
  counter += 1;
  return `test-user-${Date.now()}-${counter}@example.com`;
}

/** Registers a user via the real HTTP endpoint and returns { token, user }. */
async function registerUser(overrides = {}) {
  const payload = {
    name: "Test User",
    email: uniqueEmail(),
    password: "password123",
    ...overrides,
  };
  const res = await request(app).post("/api/v1/auth/register").send(payload);
  return { token: res.body.token, user: res.body.user };
}

/** Registers a user, then promotes them to admin directly via the model
 * (mirrors how the real first-admin bootstrap works — see README). */
async function registerAdmin(overrides = {}) {
  const { token, user } = await registerUser(overrides);
  await User.findByIdAndUpdate(user.id, { role: "admin" });
  return { token, user: { ...user, role: "admin" } };
}

/** Categories are reference/seed data, not something most tests are exercising
 * the creation of — create directly via the model instead of the (now
 * admin-only) HTTP endpoint, same as scripts/migrateCampusesToPlaces.js does. */
async function createCategory(overrides = {}) {
  const category = await Category.create({ name: "Test Category", ...overrides });
  return category;
}

module.exports = { registerUser, registerAdmin, createCategory };
