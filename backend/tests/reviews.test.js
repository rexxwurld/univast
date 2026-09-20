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

async function setupPlace() {
  const { token } = await registerUser();
  const category = await createCategory();

  const placeRes = await request(app)
    .post("/api/v1/places")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Test Cafe", category: category._id, latitude: 4.95, longitude: 8.33 });

  return { token, placeId: placeRes.body._id };
}

describe("Reviews", () => {
  it("creates a review and updates the place's rating aggregate", async () => {
    const { token, placeId } = await setupPlace();

    const reviewRes = await request(app)
      .post("/api/v1/reviews")
      .set("Authorization", `Bearer ${token}`)
      .send({ place: placeId, rating: 5, text: "Great!" });
    expect(reviewRes.status).toBe(201);

    const placeRes = await request(app).get(`/api/v1/places/${placeId}`);
    expect(placeRes.body.ratingAvg).toBe(5);
    expect(placeRes.body.ratingCount).toBe(1);
  });

  it("averages correctly across two reviews from different users", async () => {
    const { token, placeId } = await setupPlace();
    const { token: otherToken } = await registerUser();

    await request(app).post("/api/v1/reviews").set("Authorization", `Bearer ${token}`)
      .send({ place: placeId, rating: 5 });
    await request(app).post("/api/v1/reviews").set("Authorization", `Bearer ${otherToken}`)
      .send({ place: placeId, rating: 3 });

    const placeRes = await request(app).get(`/api/v1/places/${placeId}`);
    expect(placeRes.body.ratingAvg).toBe(4);
    expect(placeRes.body.ratingCount).toBe(2);
  });

  it("recomputes the aggregate after a review is deleted", async () => {
    const { token, placeId } = await setupPlace();

    const reviewRes = await request(app).post("/api/v1/reviews").set("Authorization", `Bearer ${token}`)
      .send({ place: placeId, rating: 5 });

    await request(app).delete(`/api/v1/reviews/${reviewRes.body._id}`).set("Authorization", `Bearer ${token}`);

    const placeRes = await request(app).get(`/api/v1/places/${placeId}`);
    expect(placeRes.body.ratingAvg).toBe(0);
    expect(placeRes.body.ratingCount).toBe(0);
  });

  it("rejects a second review from the same user for the same place", async () => {
    const { token, placeId } = await setupPlace();

    await request(app).post("/api/v1/reviews").set("Authorization", `Bearer ${token}`)
      .send({ place: placeId, rating: 4, text: "First" });

    const res = await request(app).post("/api/v1/reviews").set("Authorization", `Bearer ${token}`)
      .send({ place: placeId, rating: 2, text: "Second" });

    expect(res.status).toBe(409);
  });

  it("rejects an out-of-range rating", async () => {
    const { token, placeId } = await setupPlace();

    const res = await request(app)
      .post("/api/v1/reviews")
      .set("Authorization", `Bearer ${token}`)
      .send({ place: placeId, rating: 7 });

    expect(res.status).toBe(400);
  });

  it("prevents a non-author from editing someone else's review", async () => {
    const { token, placeId } = await setupPlace();
    const { token: otherToken } = await registerUser();

    const reviewRes = await request(app).post("/api/v1/reviews").set("Authorization", `Bearer ${token}`)
      .send({ place: placeId, rating: 5 });

    const res = await request(app)
      .patch(`/api/v1/reviews/${reviewRes.body._id}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ rating: 1 });

    expect(res.status).toBe(403);
  });
});
