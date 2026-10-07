const request = require("supertest");
const app = require("../app");
const University = require("../models/University");
const Campus = require("../models/Campus");
const CampusPack = require("../models/CampusPack");
const { seedDevFixture } = require("../seeds/devFixture");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser, registerWithRole, registerCoordinator } = require("./fixtures");

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
const publish = (campusId, token) => request(app).post(url(campusId, "/pack/publish")).set(auth(token));

describe("campus pack versioning", () => {
  it("reports version 0 / unpublished before the first publish, and 404s the download", async () => {
    const f = await seedDevFixture();
    const v = await request(app).get(url(f.campusId, "/pack/version"));
    expect(v.status).toBe(200);
    expect(v.body.currentVersion).toBe(0);
    expect(v.body.hasUnpublishedChanges).toBe(true);
    expect((await request(app).get(url(f.campusId, "/pack"))).status).toBe(404);
  });

  it("publishes version 1 with everything needed for offline navigation", async () => {
    const f = await seedDevFixture();
    const { token } = await registerCoordinator([f.campusId]);
    const res = await publish(f.campusId, token);
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);

    const pack = await request(app).get(url(f.campusId, "/pack"));
    expect(pack.status).toBe(200);
    expect(pack.body.version).toBe(1);
    expect(pack.body.containsDevFixture).toBe(true);
    const s = pack.body.snapshot;
    expect(s.university.name).toBe("UNIVAST Demo University");
    expect(s.buildings.map((b) => b.name)).toEqual(["Test Science Block"]);
    expect(s.rooms[0].aliases).toContain("Lecture Theater 1");
    expect(s.entrances).toHaveLength(1);
    expect(s.landmarks).toHaveLength(2);
    expect(s.navigation.nodes).toHaveLength(6);
    expect(s.navigation.edges).toHaveLength(5);
    expect(s.categories.campus).toContain("lecture_hall");
    expect(s.campus.geofence.boundary.coordinates).toHaveLength(1);
    expect(s.rooms[0].createdAt).toBeUndefined();
  });

  it("does not create a new version when nothing changed (deterministic checksum)", async () => {
    const f = await seedDevFixture();
    const { token } = await registerWithRole("admin");
    const first = await publish(f.campusId, token);
    const second = await publish(f.campusId, token);
    expect(second.status).toBe(200);
    expect(second.body.unchanged).toBe(true);
    expect(second.body.version).toBe(1);
    expect(second.body.checksum).toBe(first.body.checksum);
    expect(await CampusPack.countDocuments({ campusId: f.campusId })).toBe(1);
  });

  it("flags unpublished changes after an edit and bumps the version on the next publish", async () => {
    const f = await seedDevFixture();
    const { token } = await registerWithRole("admin");
    await publish(f.campusId, token);
    expect((await request(app).get(url(f.campusId, "/pack/version"))).body.hasUnpublishedChanges).toBe(false);

    await request(app).patch(url(f.campusId, `/buildings/${f.buildingId}`)).set(auth(token)).send({ description: "Updated" });
    const flagged = await request(app).get(url(f.campusId, "/pack/version"));
    expect(flagged.body.hasUnpublishedChanges).toBe(true);
    expect(flagged.body.currentVersion).toBe(1);

    const v2 = await publish(f.campusId, token);
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    const after = await request(app).get(url(f.campusId, "/pack/version"));
    expect(after.body.currentVersion).toBe(2);
    expect(after.body.hasUnpublishedChanges).toBe(false);
  });

  it("answers 'up to date' for a client that already has the latest version", async () => {
    const f = await seedDevFixture();
    const { token } = await registerWithRole("admin");
    await publish(f.campusId, token);
    const same = await request(app).get(url(f.campusId, "/pack")).query({ sinceVersion: 1 });
    expect(same.body).toEqual({ upToDate: true, version: 1, checksum: same.body.checksum });
    const stale = await request(app).get(url(f.campusId, "/pack")).query({ sinceVersion: 0 });
    expect(stale.body.upToDate).toBe(false);
    expect(stale.body.snapshot).toBeTruthy();
  });

  it("keeps old versions immutable", async () => {
    const f = await seedDevFixture();
    const { token } = await registerWithRole("admin");
    await publish(f.campusId, token);
    const v1 = await CampusPack.findOne({ campusId: f.campusId, version: 1 }).lean();
    await request(app).patch(url(f.campusId, `/buildings/${f.buildingId}`)).set(auth(token)).send({ description: "Changed again" });
    await publish(f.campusId, token);
    const v1After = await CampusPack.findOne({ campusId: f.campusId, version: 1 }).lean();
    expect(v1After.checksum).toBe(v1.checksum);
    expect(v1After.snapshot.buildings[0].description).not.toBe("Changed again");
  });

  it("only editors can publish", async () => {
    const f = await seedDevFixture();
    const { token } = await registerUser();
    expect((await publish(f.campusId, token)).status).toBe(403);
    expect((await request(app).post(url(f.campusId, "/pack/publish"))).status).toBe(401);
  });

  it("packs are per campus (multiple campuses/universities never mix)", async () => {
    const f = await seedDevFixture();
    const uni = await University.create({ name: "Second U", ShortName: "SU", country: "X", state: "Y" });
    const other = await Campus.create({ universityId: uni._id, name: "North", latitude: 3, longitude: 3 });
    const { token } = await registerWithRole("admin");
    await publish(f.campusId, token);
    await publish(other._id, token);
    const pack = await request(app).get(url(other._id, "/pack"));
    expect(pack.body.snapshot.buildings).toEqual([]);
    expect(pack.body.snapshot.university.name).toBe("Second U");
    expect(pack.body.containsDevFixture).toBe(false);
  });
});
