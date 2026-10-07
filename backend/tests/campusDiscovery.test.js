const request = require("supertest");
const app = require("../app");
const Category = require("../models/Category");
const { seedDevFixture } = require("../seeds/devFixture");
const { connect, closeDatabase, clearDatabase } = require("./testDb");

beforeAll(async () => {
  await connect();
});
afterEach(async () => {
  await clearDatabase();
});
afterAll(async () => {
  await closeDatabase();
});

describe("campus discovery search", () => {
  it("returns matching student-facing places with campus scope and provenance", async () => {
    const fixture = await seedDevFixture();
    await Category.create({ name: "Dining", slug: "dining" });
    const response = await request(app).get(`/api/v1/discovery/${fixture.campusId}/search`).query({ q: "LT1" });

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "room", name: "LT1", campusId: String(fixture.campusId), dataSource: "DEV_FIXTURE" }),
    ]));
    expect(response.body.categoryNames).toContain("Dining");
  });

  it("rejects unbounded query strings", async () => {
    const fixture = await seedDevFixture();
    const response = await request(app).get(`/api/v1/discovery/${fixture.campusId}/search`).query({ q: "x".repeat(101) });
    expect(response.status).toBe(400);
  });
});