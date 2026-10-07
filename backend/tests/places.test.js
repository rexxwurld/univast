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

describe("Places", () => {
  it("rejects place creation without auth", async () => {
    const category = await createCategory();

    const res = await request(app)
      .post("/api/v1/places")
      .send({ name: "Test Place", category: category._id, latitude: 4.95, longitude: 8.33 });

    expect(res.status).toBe(401);
  });

  it("creates a place when authenticated", async () => {
    const { token } = await registerUser();
    const category = await createCategory();

    const res = await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Place", category: category._id, latitude: 4.95, longitude: 8.33 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Place");
    expect(res.body.source).toBe("user");
  });

  it("finds a created place via /nearby, with distance attached", async () => {
    const { token } = await registerUser();
    const category = await createCategory();

    await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nearby Place", category: category._id, latitude: 4.95, longitude: 8.33 });

    const res = await request(app).get("/api/v1/places/nearby?lat=4.95&lng=8.33&radius=1000");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Nearby Place");
    expect(res.body.data[0].distanceMeters).toBeDefined();
  });

  it("does not return a place outside the requested radius", async () => {
    const { token } = await registerUser();
    const category = await createCategory();

    // Roughly 100km+ away from the search point below.
    await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Far Place", category: category._id, latitude: 6.5, longitude: 3.4 });

    const res = await request(app).get("/api/v1/places/nearby?lat=4.95&lng=8.33&radius=1000");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("prevents someone else from editing a place they don't own", async () => {
    const { token } = await registerUser();
    const { token: otherToken } = await registerUser();
    const category = await createCategory();

    const createRes = await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Owned Place", category: category._id, latitude: 4.95, longitude: 8.33 });

    const res = await request(app)
      .patch(`/api/v1/places/${createRes.body._id}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: "Hijacked" });

    expect(res.status).toBe(403);
  });

  it("lets the owner soft-delete their own place, after which it 404s", async () => {
    const { token } = await registerUser();
    const category = await createCategory();

    const createRes = await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "To Delete", category: category._id, latitude: 4.95, longitude: 8.33 });

    const deleteRes = await request(app)
      .delete(`/api/v1/places/${createRes.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(204);

    const getRes = await request(app).get(`/api/v1/places/${createRes.body._id}`);
    expect(getRes.status).toBe(404);
  });

  it("rejects creating a place with an invalid category id", async () => {
    const { token } = await registerUser();

    const res = await request(app)
      .post("/api/v1/places")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bad Category Place", category: "not-a-real-id", latitude: 4.95, longitude: 8.33 });

    expect(res.status).toBe(400);
  });
});
