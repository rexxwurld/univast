const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
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

async function createBusiness(token, name = "Acme Ltd") {
  return request(app).post("/api/v1/businesses").set(auth(token)).send({ name, description: "We sell things" });
}

async function createPlace(token) {
  const category = await createCategory();
  const res = await request(app)
    .post("/api/v1/places")
    .set(auth(token))
    .send({ name: "Unclaimed Shop", category: category._id, latitude: 4.95, longitude: 8.33 });
  return res.body._id;
}

describe("Businesses", () => {
  it("requires auth to create a business", async () => {
    const res = await request(app).post("/api/v1/businesses").send({ name: "No Auth" });
    expect(res.status).toBe(401);
  });

  it("requires a name", async () => {
    const { token } = await registerUser();
    const res = await request(app).post("/api/v1/businesses").set(auth(token)).send({});
    expect(res.status).toBe(400);
  });

  it("creates a business as pending and promotes the owner to the business role", async () => {
    const { token, user } = await registerUser();
    const res = await createBusiness(token);

    expect(res.status).toBe(201);
    expect(res.body.verificationStatus).toBe("pending");

    const dbUser = await User.findById(user.id);
    expect(dbUser.role).toBe("business");
  });

  it("lists only the caller's own businesses", async () => {
    const { token } = await registerUser();
    const { token: otherToken } = await registerUser();
    await createBusiness(token, "Mine");
    await createBusiness(otherToken, "Theirs");

    const res = await request(app).get("/api/v1/businesses/mine").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Mine");
  });

  it("lets the owner edit name/description", async () => {
    const { token } = await registerUser();
    const created = await createBusiness(token);

    const res = await request(app)
      .patch(`/api/v1/businesses/${created.body._id}`)
      .set(auth(token))
      .send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
  });

  it("blocks another user from editing the business", async () => {
    const { token } = await registerUser();
    const { token: otherToken } = await registerUser();
    const created = await createBusiness(token);

    const res = await request(app)
      .patch(`/api/v1/businesses/${created.body._id}`)
      .set(auth(otherToken))
      .send({ name: "Hijacked" });
    expect(res.status).toBe(403);
  });

  it("stops an owner from verifying their own business", async () => {
    const { token } = await registerUser();
    const created = await createBusiness(token);

    const res = await request(app)
      .patch(`/api/v1/businesses/${created.body._id}`)
      .set(auth(token))
      .send({ verificationStatus: "verified" });
    expect(res.status).toBe(403);
  });

  it("lets an admin verify a business, and rejects bogus statuses", async () => {
    const { token } = await registerUser();
    const { token: adminToken } = await registerAdmin();
    const created = await createBusiness(token);

    const ok = await request(app)
      .patch(`/api/v1/businesses/${created.body._id}`)
      .set(auth(adminToken))
      .send({ verificationStatus: "verified" });
    expect(ok.status).toBe(200);
    expect(ok.body.verificationStatus).toBe("verified");

    const bad = await request(app)
      .patch(`/api/v1/businesses/${created.body._id}`)
      .set(auth(adminToken))
      .send({ verificationStatus: "super-verified" });
    expect(bad.status).toBe(400);
  });
});

describe("Claiming a place", () => {
  it("rejects a plain user (no business yet) with 403", async () => {
    const { token } = await registerUser();
    const { token: ownerToken } = await registerUser();
    const placeId = await createPlace(ownerToken);

    const res = await request(app)
      .post(`/api/v1/places/${placeId}/claim`)
      .set(auth(token))
      .send({ businessId: "507f1f77bcf86cd799439011" });
    expect(res.status).toBe(403);
  });

  it("lets a business owner claim an unclaimed place, flipping its source to business", async () => {
    const { token: placeOwner } = await registerUser();
    const placeId = await createPlace(placeOwner);
    const { token } = await registerUser();
    const business = await createBusiness(token);

    const res = await request(app)
      .post(`/api/v1/places/${placeId}/claim`)
      .set(auth(token))
      .send({ businessId: business.body._id });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("business");
    expect(String(res.body.businessId)).toBe(business.body._id);
  });

  it("returns 409 when the place is already claimed", async () => {
    const { token: placeOwner } = await registerUser();
    const placeId = await createPlace(placeOwner);
    const { token } = await registerUser();
    const { token: token2 } = await registerUser();
    const b1 = await createBusiness(token, "First");
    const b2 = await createBusiness(token2, "Second");

    await request(app).post(`/api/v1/places/${placeId}/claim`).set(auth(token)).send({ businessId: b1.body._id });
    const res = await request(app)
      .post(`/api/v1/places/${placeId}/claim`)
      .set(auth(token2))
      .send({ businessId: b2.body._id });

    expect(res.status).toBe(409);
  });

  it("refuses to claim using a business owned by someone else", async () => {
    const { token: placeOwner } = await registerUser();
    const placeId = await createPlace(placeOwner);
    const { token } = await registerUser();
    const { token: otherToken } = await registerUser();
    await createBusiness(token, "Mine");
    const theirs = await createBusiness(otherToken, "Theirs");

    const res = await request(app)
      .post(`/api/v1/places/${placeId}/claim`)
      .set(auth(token))
      .send({ businessId: theirs.body._id });
    expect(res.status).toBe(403);
  });
});
