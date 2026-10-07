const request = require("supertest");
const app = require("../app");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser, registerAdmin, createCategory } = require("./fixtures");

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

async function createPlace(token) {
  const category = await createCategory();
  const res = await request(app)
    .post("/api/v1/places")
    .set(auth(token))
    .send({ name: "Reportable Place", category: category._id, latitude: 4.95, longitude: 8.33 });
  return res.body._id;
}

describe("Reports", () => {
  it("requires auth to file a report", async () => {
    const res = await request(app)
      .post("/api/v1/reports")
      .send({ targetType: "Place", targetId: "507f1f77bcf86cd799439011", reason: "spam" });
    expect(res.status).toBe(401);
  });

  it("lets any logged-in user report an existing place", async () => {
    const { token } = await registerUser();
    const placeId = await createPlace(token);
    const { token: reporter } = await registerUser();

    const res = await request(app)
      .post("/api/v1/reports")
      .set(auth(reporter))
      .send({ targetType: "Place", targetId: placeId, reason: "Wrong location" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
  });

  it("rejects an unknown targetType", async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post("/api/v1/reports")
      .set(auth(token))
      .send({ targetType: "Spaceship", targetId: "507f1f77bcf86cd799439011", reason: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed targetId", async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post("/api/v1/reports")
      .set(auth(token))
      .send({ targetType: "Place", targetId: "nope", reason: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects a report against something that does not exist", async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post("/api/v1/reports")
      .set(auth(token))
      .send({ targetType: "Place", targetId: "507f1f77bcf86cd799439011", reason: "x" });
    expect(res.status).toBe(400);
  });

  it("requires a reason", async () => {
    const { token } = await registerUser();
    const placeId = await createPlace(token);
    const res = await request(app)
      .post("/api/v1/reports")
      .set(auth(token))
      .send({ targetType: "Place", targetId: placeId });
    expect(res.status).toBe(400);
  });

  it("keeps the report queue admin-only", async () => {
    const { token } = await registerUser();
    expect((await request(app).get("/api/v1/reports")).status).toBe(401);
    expect((await request(app).get("/api/v1/reports").set(auth(token))).status).toBe(403);
  });

  it("lets an admin list, filter and resolve reports", async () => {
    const { token } = await registerUser();
    const placeId = await createPlace(token);
    const { token: adminToken } = await registerAdmin();

    const created = await request(app)
      .post("/api/v1/reports")
      .set(auth(token))
      .send({ targetType: "Place", targetId: placeId, reason: "Closed down" });

    const list = await request(app).get("/api/v1/reports?status=pending").set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const resolved = await request(app)
      .patch(`/api/v1/reports/${created.body._id}`)
      .set(auth(adminToken))
      .send({ status: "resolved", resolutionNotes: "Removed" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("resolved");
    expect(resolved.body.resolvedAt).toBeTruthy();

    const pendingAfter = await request(app).get("/api/v1/reports?status=pending").set(auth(adminToken));
    expect(pendingAfter.body.data).toHaveLength(0);
  });

  it("rejects an invalid resolution status", async () => {
    const { token } = await registerUser();
    const placeId = await createPlace(token);
    const { token: adminToken } = await registerAdmin();
    const created = await request(app)
      .post("/api/v1/reports")
      .set(auth(token))
      .send({ targetType: "Place", targetId: placeId, reason: "x" });

    const res = await request(app)
      .patch(`/api/v1/reports/${created.body._id}`)
      .set(auth(adminToken))
      .send({ status: "pending" });
    expect(res.status).toBe(400);
  });
});
