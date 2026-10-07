const request = require("supertest");
const app = require("../app");
const University = require("../models/University");
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const Room = require("../models/Room");
const NavigationNode = require("../models/NavigationNode");
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

const buildingBody = { name: "New Block", type: "faculty", latitude: 0.0002, longitude: 0.0012, aliases: ["NB"] };

describe("authorization on every campus-data write (server-side)", () => {
  // [method, path-builder, body-builder]
  const endpoints = (f) => [
    ["post", url(f.campusId, "/buildings"), buildingBody],
    ["patch", url(f.campusId, `/buildings/${f.buildingId}`), { description: "x" }],
    ["delete", url(f.campusId, `/buildings/${f.buildingId}`), undefined],
    ["post", url(f.campusId, "/floors"), { buildingId: String(f.buildingId), floorNumber: 1 }],
    ["post", url(f.campusId, "/rooms"), { floorId: String(f.floorId), name: "Room 2" }],
    ["post", url(f.campusId, "/entrances"), { buildingId: String(f.buildingId), name: "Back", latitude: 0, longitude: 0 }],
    ["post", url(f.campusId, "/landmarks"), { name: "Fountain", latitude: 0, longitude: 0 }],
    ["put", url(f.campusId, "/geofence"), { nearBufferMeters: 10 }],
    ["patch", url(f.campusId, "/settings"), { routing: { maxSnapMeters: 50 } }],
    ["post", url(f.campusId, "/pack/publish"), undefined],
  ];

  it("rejects anonymous callers with 401 on every write endpoint", async () => {
    const f = await seedDevFixture();
    for (const [method, path, body] of endpoints(f)) {
      const res = await request(app)[method](path).send(body);
      expect([method, path, res.status]).toEqual([method, path, 401]);
    }
  });

  it.each(["user", "business", "moderator"])("rejects the '%s' role with 403 on every write endpoint", async (role) => {
    const f = await seedDevFixture();
    const { token } = await registerWithRole(role);
    for (const [method, path, body] of endpoints(f)) {
      const res = await request(app)[method](path).set(auth(token)).send(body);
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    expect(await Building.countDocuments({ name: "New Block" })).toBe(0);
  });

  it.each(["admin", "campus_coordinator"])("allows the '%s' role", async (role) => {
    const f = await seedDevFixture();
    const { token } = role === "admin" ? await registerWithRole("admin") : await registerCoordinator([f.campusId]);
    const res = await request(app).post(url(f.campusId, "/buildings")).set(auth(token)).send(buildingBody);
    expect(res.status).toBe(201);
  });

  it("does not leak whether an id exists to anonymous callers (auth runs before lookup)", async () => {
    const res = await request(app).post(url("507f1f77bcf86cd799439011", "/buildings")).send(buildingBody);
    expect(res.status).toBe(401);
  });

  it("keeps reads public", async () => {
    const f = await seedDevFixture();
    expect((await request(app).get(url(f.campusId, "/buildings"))).status).toBe(200);
  });
});

describe("building / floor / room / entrance / landmark CRUD", () => {
  it("creates a building as 'manual' even if the client tries to set dataSource, and ignores searchKeys", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const res = await request(app)
      .post(url(f.campusId, "/buildings"))
      .set(auth(token))
      .send({ ...buildingBody, dataSource: "DEV_FIXTURE", searchKeys: ["evil"], campusId: "507f1f77bcf86cd799439011" });
    expect(res.status).toBe(201);
    expect(res.body.dataSource).toBe("manual");
    expect(res.body.searchKeys).toEqual(["new block", "nb"]);
    expect(String(res.body.campusId)).toBe(String(f.campusId));
  });

  it("validates bodies", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const post = (body) => request(app).post(url(f.campusId, "/buildings")).set(auth(token)).send(body);
    expect((await post({ ...buildingBody, latitude: 91 })).status).toBe(400);
    expect((await post({ ...buildingBody, name: "" })).status).toBe(400);
    expect((await post({ ...buildingBody, type: "spaceport" })).status).toBe(400);
    expect((await post({ ...buildingBody, name: "Test Science Block" })).status).toBe(400); // duplicate name on the campus
  });

  it("creates floor -> room; the room's building is derived from its floor", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const floor = await request(app).post(url(f.campusId, "/floors")).set(auth(token)).send({ buildingId: String(f.buildingId), floorNumber: 1, name: "First Floor" });
    expect(floor.status).toBe(201);
    const room = await request(app)
      .post(url(f.campusId, "/rooms"))
      .set(auth(token))
      .send({ floorId: floor.body._id, name: "Room 104", roomNumber: "104", type: "classroom", aliases: ["Rm 104"] });
    expect(room.status).toBe(201);
    expect(String(room.body.buildingId)).toBe(String(f.buildingId));
    expect(room.body.searchKeys).toEqual(["rm104", "104"]); // name/alias and bare room number

    const found = await request(app).get(url(f.campusId, "/search")).query({ q: "room 104" });
    expect(found.body.results[0].id).toBe(room.body._id);
    expect(found.body.results[0].floor.name).toBe("First Floor");
  });

  it("rejects parents that belong to another campus", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const uni = await University.create({ name: "U2", ShortName: "U2", country: "X", state: "Y" });
    const other = await Campus.create({ universityId: uni._id, name: "C2", latitude: 5, longitude: 5 });
    const res = await request(app).post(url(other._id, "/floors")).set(auth(token)).send({ buildingId: String(f.buildingId), floorNumber: 3 });
    expect(res.status).toBe(400);
    const res2 = await request(app).post(url(other._id, "/rooms")).set(auth(token)).send({ floorId: String(f.floorId), name: "X" });
    expect(res2.status).toBe(400);
  });

  it("rejects an entrance linked to a navigation node of another campus", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const uni = await University.create({ name: "U2", ShortName: "U2", country: "X", state: "Y" });
    const other = await Campus.create({ universityId: uni._id, name: "C2", latitude: 5, longitude: 5 });
    const foreignNode = await NavigationNode.create({ campusId: other._id, name: "far", latitude: 5, longitude: 5 });
    const res = await request(app)
      .post(url(f.campusId, "/entrances"))
      .set(auth(token))
      .send({ buildingId: String(f.buildingId), name: "Back Door", latitude: 0, longitude: 0, navigationNodeId: String(foreignNode._id) });
    expect(res.status).toBe(400);
  });

  it("creates an entrance linked to a node on its own campus, and a landmark", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const ent = await request(app)
      .post(url(f.campusId, "/entrances"))
      .set(auth(token))
      .send({ buildingId: String(f.buildingId), name: "Side", latitude: 0, longitude: 0, navigationNodeId: String(f.junctionNodeId) });
    expect(ent.status).toBe(201);
    const lm = await request(app).post(url(f.campusId, "/landmarks")).set(auth(token)).send({ name: "Fountain", latitude: 0.0003, longitude: 0.0003, aliases: ["The Fountain"] });
    expect(lm.status).toBe(201);
    expect(lm.body.type).toBe("landmark");
  });

  it("re-indexes search keys when aliases change (edit goes through save())", async () => {
    const f = await seedDevFixture();
    const { token } = await registerCoordinator([f.campusId]);
    const patch = await request(app).patch(url(f.campusId, `/rooms/${f.roomId}`)).set(auth(token)).send({ aliases: ["LT1", "Great Hall"] });
    expect(patch.status).toBe(200);
    const res = await request(app).get(url(f.campusId, "/search")).query({ q: "Great Hall" });
    expect(res.body.results[0].id).toBe(String(f.roomId));
    // The removed alias "Test LT1" is no longer an exact key (it can still match weakly through building context).
    const old = await request(app).get(url(f.campusId, "/search")).query({ q: "Test LT1" });
    expect(old.body.results.some((r) => r.id === String(f.roomId) && r.score === 100)).toBe(false);
  });

  it("moves a building (coordinates edit) and persists it", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const res = await request(app).patch(url(f.campusId, `/buildings/${f.buildingId}`)).set(auth(token)).send({ latitude: 0.0007, longitude: 0.0007 });
    expect(res.status).toBe(200);
    const stored = await Building.findById(f.buildingId);
    expect(stored.latitude).toBe(0.0007);
  });

  it("404s edits/deletes of records on a different campus or that don't exist", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const uni = await University.create({ name: "U2", ShortName: "U2", country: "X", state: "Y" });
    const other = await Campus.create({ universityId: uni._id, name: "C2", latitude: 5, longitude: 5 });
    expect((await request(app).patch(url(other._id, `/buildings/${f.buildingId}`)).set(auth(token)).send({ description: "x" })).status).toBe(404);
    expect((await request(app).delete(url(other._id, `/buildings/${f.buildingId}`)).set(auth(token))).status).toBe(404);
    expect((await request(app).patch(url(f.campusId, "/buildings/not-an-id")).set(auth(token)).send({})).status).toBe(400);
  });

  it("refuses to delete a building or floor that still has children, then allows it bottom-up", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const del = (path) => request(app).delete(url(f.campusId, path)).set(auth(token));

    expect((await del(`/buildings/${f.buildingId}`)).status).toBe(409);
    expect((await del(`/floors/${f.floorId}`)).status).toBe(409);
    expect((await del(`/rooms/${f.roomId}`)).status).toBe(204);
    expect((await del(`/floors/${f.floorId}`)).status).toBe(204);
    expect((await del(`/entrances/${f.entranceId}`)).status).toBe(204);
    expect((await del(`/buildings/${f.buildingId}`)).status).toBe(204);
    expect(await Room.countDocuments({ buildingId: f.buildingId })).toBe(0);
  });
});

describe("geofence and settings configuration", () => {
  it("lets an editor configure a polygon, which immediately drives /locate", async () => {
    const f = await seedDevFixture();
    const { token } = await registerCoordinator([f.campusId]);
    const ring = [[10, 10], [10.01, 10], [10.01, 10.01], [10, 10.01], [10, 10]];
    const put = await request(app).put(url(f.campusId, "/geofence")).set(auth(token)).send({ boundary: { coordinates: [ring] }, nearBufferMeters: 500 });
    expect(put.status).toBe(200);
    expect(put.body.boundary.type).toBe("Polygon");

    const inside = await request(app).post(url(f.campusId, "/locate")).send({ latitude: 10.005, longitude: 10.005 });
    expect(inside.body.status).toBe("inside");
    const old = await request(app).post(url(f.campusId, "/locate")).send({ latitude: 0.0005, longitude: 0.0005 });
    expect(old.body.status).toBe("outside");
  });

  it("rejects an invalid polygon (unclosed ring) and leaves the old boundary intact", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const res = await request(app)
      .put(url(f.campusId, "/geofence"))
      .set(auth(token))
      .send({ boundary: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } });
    expect(res.status).toBe(400);
    const loc = await request(app).post(url(f.campusId, "/locate")).send({ latitude: 0.0005, longitude: 0.0005 });
    expect(loc.body.status).toBe("inside");
  });

  it("supports a radius-only geofence and clearing the polygon -> unknown when nothing is left", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const radius = await request(app).put(url(f.campusId, "/geofence")).set(auth(token)).send({ boundary: null, radiusMeters: 300 });
    expect(radius.status).toBe(200);
    expect((await request(app).post(url(f.campusId, "/locate")).send({ latitude: 0.0005, longitude: 0.0006 })).body.status).toBe("inside");

    await request(app).put(url(f.campusId, "/geofence")).set(auth(token)).send({ radiusMeters: null });
    expect((await request(app).post(url(f.campusId, "/locate")).send({ latitude: 0.0005, longitude: 0.0006 })).body.status).toBe("unknown");
  });

  it("updates routing and map settings", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const res = await request(app).patch(url(f.campusId, "/settings")).set(auth(token)).send({ routing: { maxSnapMeters: 60 }, mapMetadata: { defaultZoom: 17 } });
    expect(res.status).toBe(200);
    expect(res.body.routing.maxSnapMeters).toBe(60);
    expect((await Campus.findById(f.campusId)).mapMetadata.defaultZoom).toBe(17);
    expect((await request(app).patch(url(f.campusId, "/settings")).set(auth(token)).send({ routing: { maxSnapMeters: 0 } })).status).toBe(400);
  });
});

describe("a normal user cannot reach admin capabilities by URL", () => {
  it("is blocked from existing admin routes too", async () => {
    const { token } = await registerUser();
    expect((await request(app).get("/api/v1/admin/stats").set(auth(token))).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/users").set(auth(token))).status).toBe(403);
  });
});
