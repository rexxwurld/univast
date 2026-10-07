const request = require("supertest");
const app = require("../app");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser, createCategory } = require("./fixtures");

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe("NoSQL injection protection", () => {
  it("does not let a $ operator injected via query-string bracket notation bypass a filter", async () => {
    const { token } = await registerUser();
    const category = await createCategory();

    const placeA = await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Place A", category: category._id, latitude: 1, longitude: 1 });
    const placeB = await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Place B", category: category._id, latitude: 2, longitude: 2 });

    await request(app)
      .post("/api/v1/reviews")
      .set("Authorization", `Bearer ${token}`)
      .send({ place: placeA.body._id, rating: 5 });

    // Without sanitization this becomes the filter { place: { $ne: <Place B id> } },
    // which would match — and leak — the review for Place A. The exact status
    // code that comes back doesn't matter here; what matters is that Place A's
    // review is never returned by a request that only asked to exclude Place B.
    const res = await request(app).get(`/api/v1/reviews?place[$ne]=${placeB.body._id}`);

    const leaked = res.status === 200 && (res.body.data || []).some((r) => r.place === placeA.body._id);
    expect(leaked).toBe(false);
  });

  it("does not let a $ operator injected via the request body reach a query", async () => {
    // If sanitization ever regresses, this would let an attacker match every
    // place by category regardless of the id supplied.
    const { token } = await registerUser();

    const res = await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Injected", category: { $ne: null }, latitude: 1, longitude: 1 });

    // Sanitization strips the $ne key, leaving category as {} — which is not
    // a valid ObjectId, so this must fail rather than silently succeed.
    expect(res.status).toBe(400);
  });
});
