const University = require("../models/University");
const Campus = require("../models/Campus");
const Location = require("../models/Location");
const NavigationNode = require("../models/NavigationNode");
const MigrationRecord = require("../models/MigrationRecord");
const { runMigrations } = require("../scripts/migrate");
const { reindexSearchKeys } = require("../scripts/reindexSearchKeys");
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

/** Inserts documents exactly as the PRE-migration app wrote them: raw, no new fields, no defaults. */
async function insertLegacyCampus() {
  const now = new Date();
  const uni = (await University.collection.insertOne({ name: "Old University", ShortName: "OLD", country: "Nigeria", state: "Cross River", createdAt: now, updatedAt: now })).insertedId;
  const campus = (await Campus.collection.insertOne({ universityId: uni, name: "Old Main Campus", description: "", latitude: 4.95, longitude: 8.33, createdAt: now, updatedAt: now })).insertedId;
  const node = (await NavigationNode.collection.insertOne({ campusId: campus, name: "Old Gate", type: "intersection", latitude: 4.95, longitude: 8.33, locationId: null, createdAt: now, updatedAt: now })).insertedId;
  const loc = (await Location.collection.insertOne({ campusId: campus, name: "Old Library", category: "library", description: "", latitude: 4.951, longitude: 8.331, aliases: ["Main Library"], createdAt: now, updatedAt: now })).insertedId;
  return { uni, campus, node, loc };
}

describe("001-campus-foundation migration", () => {
  it("dry run reports what would change and writes nothing", async () => {
    const ids = await insertLegacyCampus();
    const results = await runMigrations({ dryRun: true });
    expect(results[0].status).toBe("would_apply");
    expect(results[0].summary["University_markLegacy"]).toBe(1);
    expect(results[0].summary["University_abbreviation"]).toBe(1);

    const uni = await University.collection.findOne({ _id: ids.uni });
    expect(uni.dataSource).toBeUndefined();
    expect(uni.abbreviation).toBeUndefined();
    expect(await MigrationRecord.countDocuments({})).toBe(0);
  });

  it("applies: marks legacy rows, fills abbreviation, initialises pack counters, builds Location search keys", async () => {
    const ids = await insertLegacyCampus();
    const results = await runMigrations({ dryRun: false });
    expect(results[0].status).toBe("applied");

    const uni = await University.collection.findOne({ _id: ids.uni });
    expect(uni.dataSource).toBe("legacy");
    expect(uni.abbreviation).toBe("OLD");
    expect(uni.ShortName).toBe("OLD"); // legacy field untouched

    const campus = await Campus.collection.findOne({ _id: ids.campus });
    expect(campus.dataSource).toBe("legacy");
    expect(campus.pack).toEqual({ currentVersion: 0, hasUnpublishedChanges: true, lastPublishedAt: null });
    expect(campus.geofence).toBeUndefined(); // geofence is NEVER invented for an existing campus

    const loc = await Location.collection.findOne({ _id: ids.loc });
    expect(loc.dataSource).toBe("legacy");
    expect(loc.searchKeys.sort()).toEqual(["main library", "old library"]);

    expect((await NavigationNode.collection.findOne({ _id: ids.node })).dataSource).toBe("legacy");
  });

  it("preserves ids and legacy fields (nothing is recreated)", async () => {
    const ids = await insertLegacyCampus();
    await runMigrations({ dryRun: false });
    const campus = await Campus.findById(ids.campus);
    expect(campus.name).toBe("Old Main Campus");
    expect(campus.latitude).toBe(4.95);
    expect(String(campus.universityId)).toBe(String(ids.uni));
  });

  it("is idempotent: a second run applies nothing", async () => {
    await insertLegacyCampus();
    await runMigrations({ dryRun: false });
    const again = await runMigrations({ dryRun: false });
    expect(again[0].status).toBe("already_applied");
    expect(await MigrationRecord.countDocuments({})).toBe(1);
  });

  it("never relabels DEV_FIXTURE rows as legacy", async () => {
    const f = await seedDevFixture();
    await insertLegacyCampus();
    await runMigrations({ dryRun: false });
    expect((await Campus.findById(f.campusId)).dataSource).toBe("DEV_FIXTURE");
    expect(await Campus.countDocuments({ dataSource: "legacy" })).toBe(1);
  });

  it("legacy campuses work with the new API after migration (search finds the legacy Location)", async () => {
    const request = require("supertest");
    const app = require("../app");
    const ids = await insertLegacyCampus();
    await runMigrations({ dryRun: false });
    const res = await request(app).get(`/api/v1/campus-data/${ids.campus}/search`).query({ q: "Main Library" });
    expect(res.status).toBe(200);
    expect(res.body.results[0].kind).toBe("location");
    expect(res.body.results[0].dataSource).toBe("legacy");
    const locate = await request(app).post(`/api/v1/campus-data/${ids.campus}/locate`).send({ latitude: 4.95, longitude: 8.33 });
    expect(locate.body.status).toBe("unknown");
  });
});

describe("reindexSearchKeys", () => {
  it("rebuilds keys that were wiped or stale", async () => {
    const ids = await insertLegacyCampus();
    await runMigrations({ dryRun: false });
    await Location.collection.updateOne({ _id: ids.loc }, { $set: { searchKeys: ["stale"] } });
    const counts = await reindexSearchKeys();
    expect(counts.Location).toBe(1);
    expect((await Location.collection.findOne({ _id: ids.loc })).searchKeys.sort()).toEqual(["main library", "old library"]);
  });
});
