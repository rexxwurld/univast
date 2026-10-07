const request = require("supertest");
const app = require("../app");
const University = require("../models/University");
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const User = require("../models/User");
const { seedDevFixture } = require("../seeds/devFixture");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser, registerAdmin, registerWithRole, registerCoordinator } = require("./fixtures");

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
const url = (campusId, path = "") => `/api/v1/campus-data/${campusId}${path}`;
const body = { name: "Scoped Block", latitude: 0.0002, longitude: 0.0012 };

async function secondCampus(name = "Other Campus") {
  const uni = await University.create({ name: `${name} University`, ShortName: "OU", country: "X", state: "Y" });
  return Campus.create({ universityId: uni._id, name, latitude: 5, longitude: 5 });
}

const writes = (f) => [
  ["post", url(f.campusId, "/buildings"), body],
  ["patch", url(f.campusId, `/buildings/${f.buildingId}`), { description: "x" }],
  ["delete", url(f.campusId, `/rooms/${f.roomId}`), undefined],
  ["post", url(f.campusId, "/floors"), { buildingId: String(f.buildingId), floorNumber: 2 }],
  ["post", url(f.campusId, "/landmarks"), { name: "Fountain", latitude: 0, longitude: 0 }],
  ["put", url(f.campusId, "/geofence"), { nearBufferMeters: 10 }],
  ["patch", url(f.campusId, "/settings"), { routing: { maxSnapMeters: 50 } }],
  ["post", url(f.campusId, "/pack/publish"), undefined],
];

describe("campus_coordinator is scoped to assigned campuses", () => {
  it("can write to an assigned campus", async () => {
    const f = await seedDevFixture();
    const { token } = await registerCoordinator([f.campusId]);
    const res = await request(app).post(url(f.campusId, "/buildings")).set(auth(token)).send(body);
    expect(res.status).toBe(201);
  });

  it("gets 403 on EVERY write endpoint of a campus it is not assigned to, and nothing changes", async () => {
    const f = await seedDevFixture();
    const other = await secondCampus();
    const { token } = await registerCoordinator([other._id]); // assigned elsewhere
    for (const [method, path, payload] of writes(f)) {
      const res = await request(app)[method](path).set(auth(token)).send(payload);
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    expect(await Building.countDocuments({ name: "Scoped Block" })).toBe(0);
    expect(await Building.findById(f.buildingId)).toBeTruthy();
  });

  it("a coordinator with no assigned campuses (the default) can write nowhere", async () => {
    const f = await seedDevFixture();
    const { token } = await registerCoordinator([]);
    for (const [method, path, payload] of writes(f)) {
      const res = await request(app)[method](path).set(auth(token)).send(payload);
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
  });

  it("supports several campuses, each independently", async () => {
    const f = await seedDevFixture();
    const other = await secondCampus();
    const third = await secondCampus("Third Campus");
    const { token } = await registerCoordinator([f.campusId, other._id]);
    expect((await request(app).post(url(f.campusId, "/buildings")).set(auth(token)).send(body)).status).toBe(201);
    expect((await request(app).post(url(other._id, "/buildings")).set(auth(token)).send(body)).status).toBe(201);
    expect((await request(app).post(url(third._id, "/buildings")).set(auth(token)).send(body)).status).toBe(403);
  });

  it("gives the same 403 for a campus that does not exist (no existence probing)", async () => {
    const f = await seedDevFixture();
    const { token } = await registerCoordinator([f.campusId]);
    const res = await request(app).post(url("507f1f77bcf86cd799439011", "/buildings")).set(auth(token)).send(body);
    expect(res.status).toBe(403);
  });

  it("a coordinator of campus A cannot edit a record of campus B by id through campus A's URL", async () => {
    const f = await seedDevFixture();
    const other = await secondCampus();
    const { token } = await registerCoordinator([other._id]);
    // Their own campus URL, but the building id belongs to the fixture campus.
    const res = await request(app).patch(url(other._id, `/buildings/${f.buildingId}`)).set(auth(token)).send({ description: "hijack" });
    expect(res.status).toBe(404);
    expect((await Building.findById(f.buildingId)).description).not.toBe("hijack");
  });

  it("reads stay public for everyone", async () => {
    const f = await seedDevFixture();
    expect((await request(app).get(url(f.campusId, "/buildings"))).status).toBe(200);
  });

  it("revocation takes effect on the very next request", async () => {
    const f = await seedDevFixture();
    const { token, user } = await registerCoordinator([f.campusId]);
    expect((await request(app).post(url(f.campusId, "/buildings")).set(auth(token)).send(body)).status).toBe(201);
    await User.findByIdAndUpdate(user.id, { campusIds: [] });
    expect((await request(app).post(url(f.campusId, "/buildings")).set(auth(token)).send({ ...body, name: "Second" })).status).toBe(403);
  });
});

describe("admin remains global", () => {
  it("can write to any campus with no assignment", async () => {
    const f = await seedDevFixture();
    const other = await secondCampus();
    const { token } = await registerAdmin();
    expect((await request(app).post(url(f.campusId, "/buildings")).set(auth(token)).send(body)).status).toBe(201);
    expect((await request(app).post(url(other._id, "/buildings")).set(auth(token)).send(body)).status).toBe(201);
  });

  it("still gets 404 (not 403) for a campus that does not exist", async () => {
    const { token } = await registerAdmin();
    expect((await request(app).post(url("507f1f77bcf86cd799439011", "/buildings")).set(auth(token)).send(body)).status).toBe(404);
  });
});

describe("full role matrix on every write endpoint (assigned campus)", () => {
  const expected = { anonymous: 401, user: 403, business: 403, moderator: 403, campus_coordinator: "allowed", admin: "allowed" };

  it.each(Object.keys(expected))("%s", async (who) => {
    const f = await seedDevFixture();
    let token = null;
    if (who === "campus_coordinator") ({ token } = await registerCoordinator([f.campusId]));
    else if (who === "admin") ({ token } = await registerAdmin());
    else if (who === "user") ({ token } = await registerUser());
    else if (who !== "anonymous") ({ token } = await registerWithRole(who));

    for (const [method, path, payload] of writes(f)) {
      let req = request(app)[method](path);
      if (token) req = req.set(auth(token));
      const res = await req.send(payload);
      if (expected[who] === "allowed") expect([method, path, res.status < 400]).toEqual([method, path, true]);
      else expect([method, path, res.status]).toEqual([method, path, expected[who]]);
    }
  });
});

describe("PUT /api/v1/admin/users/:id/campuses", () => {
  const put = (token, id, payload) => request(app).put(`/api/v1/admin/users/${id}/campuses`).set(auth(token)).send(payload);

  it("lets an admin assign campuses to a coordinator, which immediately grants access", async () => {
    const f = await seedDevFixture();
    const admin = await registerAdmin();
    const coord = await registerWithRole("campus_coordinator");
    expect((await request(app).post(url(f.campusId, "/buildings")).set(auth(coord.token)).send(body)).status).toBe(403);

    const res = await put(admin.token, coord.user.id, { campusIds: [String(f.campusId)] });
    expect(res.status).toBe(200);
    expect(res.body.campusIds.map(String)).toEqual([String(f.campusId)]);
    expect((await request(app).post(url(f.campusId, "/buildings")).set(auth(coord.token)).send(body)).status).toBe(201);
  });

  it("de-duplicates, and [] revokes everything", async () => {
    const f = await seedDevFixture();
    const admin = await registerAdmin();
    const coord = await registerWithRole("campus_coordinator");
    const id = String(f.campusId);
    expect((await put(admin.token, coord.user.id, { campusIds: [id, id] })).body.campusIds).toHaveLength(1);
    expect((await put(admin.token, coord.user.id, { campusIds: [] })).body.campusIds).toHaveLength(0);
  });

  it("rejects unknown campuses, malformed ids and non-arrays", async () => {
    const admin = await registerAdmin();
    const coord = await registerWithRole("campus_coordinator");
    expect((await put(admin.token, coord.user.id, { campusIds: ["507f1f77bcf86cd799439011"] })).status).toBe(400);
    expect((await put(admin.token, coord.user.id, { campusIds: ["nope"] })).status).toBe(400);
    expect((await put(admin.token, coord.user.id, { campusIds: "507f1f77bcf86cd799439011" })).status).toBe(400);
    expect((await put(admin.token, coord.user.id, { campusIds: [{ $ne: null }] })).status).toBe(400);
  });

  it("refuses to assign campuses to users who are not coordinators", async () => {
    const f = await seedDevFixture();
    const admin = await registerAdmin();
    const user = await registerUser();
    const res = await put(admin.token, user.user.id, { campusIds: [String(f.campusId)] });
    expect(res.status).toBe(409);
    expect((await User.findById(user.user.id)).campusIds).toHaveLength(0);
  });

  it("404s an unknown user", async () => {
    const admin = await registerAdmin();
    expect((await put(admin.token, "507f1f77bcf86cd799439011", { campusIds: [] })).status).toBe(404);
  });

  it("is admin-only: coordinators, moderators and users cannot grant themselves access", async () => {
    const f = await seedDevFixture();
    const coord = await registerCoordinator([]);
    const moderator = await registerWithRole("moderator");
    const user = await registerUser();
    for (const actor of [coord, moderator, user]) {
      const res = await put(actor.token, coord.user.id, { campusIds: [String(f.campusId)] });
      expect(res.status).toBe(403);
    }
    expect((await User.findById(coord.user.id)).campusIds).toHaveLength(0);
    expect((await request(app).put(`/api/v1/admin/users/${coord.user.id}/campuses`).send({ campusIds: [] })).status).toBe(401);
  });

  it("demoting a coordinator clears their assignments, so re-promotion never resurrects old access", async () => {
    const f = await seedDevFixture();
    const admin = await registerAdmin();
    const coord = await registerCoordinator([f.campusId]);
    const setRole = (role) => request(app).patch(`/api/v1/admin/users/${coord.user.id}/role`).set(auth(admin.token)).send({ role });

    expect((await setRole("user")).status).toBe(200);
    expect((await User.findById(coord.user.id)).campusIds).toHaveLength(0);
    expect((await setRole("campus_coordinator")).status).toBe(200);
    expect((await request(app).post(url(f.campusId, "/buildings")).set(auth(coord.token)).send(body)).status).toBe(403);
  });
});
