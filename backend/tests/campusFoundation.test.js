const request = require("supertest");
const app = require("../app");
const University = require("../models/University");
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Entrance = require("../models/Entrance");
const Landmark = require("../models/Landmark");
const NavigationNode = require("../models/NavigationNode");
const NavigationEdge = require("../models/NavigationEdge");
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

const base = (campusId) => `/api/v1/campus-data/${campusId}`;
const search = (campusId, q) => request(app).get(`${base(campusId)}/search`).query({ q });

describe("DEV_FIXTURE data model", () => {
  it("creates the full University -> Campus -> Building -> Floor -> Room chain, all marked DEV_FIXTURE", async () => {
    const f = await seedDevFixture();
    expect(f.created).toBe(true);

    const docs = [
      await University.findById(f.universityId),
      await Campus.findById(f.campusId),
      await Building.findById(f.buildingId),
      await Floor.findById(f.floorId),
      await Room.findById(f.roomId),
      await Entrance.findById(f.entranceId),
      await Landmark.findById(f.gateLandmarkId),
      await NavigationNode.findById(f.entranceNodeId),
    ];
    for (const doc of docs) {
      expect(doc.dataSource).toBe("DEV_FIXTURE");
      expect(doc.verificationStatus).toBe("needs_verification");
    }
    expect(await NavigationNode.countDocuments({ campusId: f.campusId })).toBe(6);
    expect(await NavigationEdge.countDocuments({ campusId: f.campusId })).toBe(5);
  });

  it("is idempotent", async () => {
    const first = await seedDevFixture();
    const second = await seedDevFixture();
    expect(second.created).toBe(false);
    expect(String(second.campusId)).toBe(String(first.campusId));
    expect(await University.countDocuments({})).toBe(1);
  });

  it("links room -> floor -> building and the entrance to a walking-graph node", async () => {
    const f = await seedDevFixture();
    const room = await Room.findById(f.roomId);
    expect(String(room.floorId)).toBe(String(f.floorId));
    expect(String(room.buildingId)).toBe(String(f.buildingId));
    const entrance = await Entrance.findById(f.entranceId);
    expect(String(entrance.navigationNodeId)).toBe(String(f.entranceNodeId));
  });

  it("stores normalized, de-duplicated search keys on the room", async () => {
    const f = await seedDevFixture();
    const room = await Room.findById(f.roomId);
    expect(room.searchKeys.sort()).toEqual(["lt1", "test lt1"]);
  });
});

describe("model validation", () => {
  it("rejects a campus boundary that is not a closed ring", async () => {
    const f = await seedDevFixture();
    const campus = await Campus.findById(f.campusId);
    campus.geofence.boundary = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] };
    await expect(campus.save()).rejects.toThrow(/closed/);
  });

  it("rejects a non-integer floor number and a duplicate floor", async () => {
    const f = await seedDevFixture();
    await expect(Floor.create({ campusId: f.campusId, buildingId: f.buildingId, floorNumber: 1.5 })).rejects.toThrow();
    await expect(Floor.create({ campusId: f.campusId, buildingId: f.buildingId, floorNumber: 0 })).rejects.toThrow(/duplicate|E11000/i);
  });

  it("rejects an unknown building category", async () => {
    const f = await seedDevFixture();
    await expect(Building.create({ campusId: f.campusId, name: "X", type: "spaceport", latitude: 0, longitude: 0 })).rejects.toThrow();
  });

  it("fills University.abbreviation from legacy ShortName", async () => {
    const u = await University.create({ name: "Legacy U", ShortName: "LU", country: "X", state: "Y" });
    expect(u.abbreviation).toBe("LU");
  });

  it("defaults new records to dataSource manual / unverified (not DEV_FIXTURE)", async () => {
    const f = await seedDevFixture();
    const b = await Building.create({ campusId: f.campusId, name: "Real Block", latitude: 0, longitude: 0 });
    expect(b.dataSource).toBe("manual");
    expect(b.verificationStatus).toBe("unverified");
  });
});

describe("GET /campus-data/campuses", () => {
  it("lists campuses with university info, geofence status and dataSource", async () => {
    const f = await seedDevFixture();
    const res = await request(app).get("/api/v1/campus-data/campuses");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(String(f.campusId));
    expect(res.body[0].university.abbreviation).toBe("DEMO");
    expect(res.body[0].geofenceConfigured).toBe(true);
    expect(res.body[0].dataSource).toBe("DEV_FIXTURE");
  });
});

describe("campus search", () => {
  it.each(["LT1", "lt1", "LT 1", "Lecture Theatre 1", "Lecture Theater 1", "Test LT1"])("'%s' resolves to the LT1 room", async (q) => {
    const f = await seedDevFixture();
    const res = await search(f.campusId, q);
    expect(res.status).toBe(200);
    expect(res.body.results[0].kind).toBe("room");
    expect(res.body.results[0].id).toBe(String(f.roomId));
    expect(res.body.results[0].building.name).toBe("Test Science Block");
    expect(res.body.results[0].floor.name).toBe("Ground Floor");
    expect(res.body.results[0].dataSource).toBe("DEV_FIXTURE");
  });

  it("finds a building by alias and by partial name", async () => {
    const f = await seedDevFixture();
    for (const q of ["Old Science Block", "old sci", "TSB"]) {
      const res = await search(f.campusId, q);
      expect(res.body.results[0].kind).toBe("building");
      expect(res.body.results[0].id).toBe(String(f.buildingId));
    }
  });

  it("finds landmarks and legacy Locations by alias", async () => {
    const f = await seedDevFixture();
    const gate = await search(f.campusId, "Front Gate");
    expect(gate.body.results[0].kind).toBe("landmark");
    const atm = await search(f.campusId, "cash machine");
    expect(atm.body.results[0].kind).toBe("location");
  });

  it("combines building and room context: 'science lt1'", async () => {
    const f = await seedDevFixture();
    const res = await search(f.campusId, "science lt1");
    expect(res.body.results[0].id).toBe(String(f.roomId));
  });

  it("supports category queries ('library', 'lecture halls')", async () => {
    const f = await seedDevFixture();
    const lib = await search(f.campusId, "library");
    expect(lib.body.results.some((r) => r.name === "Demo Library")).toBe(true);
    const lts = await search(f.campusId, "lecture halls");
    expect(lts.body.category).toBe("lecture_hall");
    expect(lts.body.results.some((r) => r.id === String(f.roomId))).toBe(true);
  });

  it("does not confuse LT1 with LT2", async () => {
    const f = await seedDevFixture();
    await Room.create({ campusId: f.campusId, buildingId: f.buildingId, floorId: f.floorId, name: "LT2", type: "lecture_hall", aliases: ["Lecture Theatre 2"] });
    const res = await search(f.campusId, "LT1");
    expect(res.body.results.map((r) => r.name)).not.toContain("LT2");
    const res2 = await search(f.campusId, "lecture theatre 2");
    expect(res2.body.results[0].name).toBe("LT2");
  });

  it("flags ambiguity when two rooms share an exact name", async () => {
    const f = await seedDevFixture();
    const other = await Building.create({ campusId: f.campusId, name: "Second Block", latitude: 0.0002, longitude: 0.0012 });
    const floor = await Floor.create({ campusId: f.campusId, buildingId: other._id, floorNumber: 0, name: "Ground Floor" });
    await Room.create({ campusId: f.campusId, buildingId: other._id, floorId: floor._id, name: "LT1", type: "lecture_hall" });
    const res = await search(f.campusId, "LT1");
    expect(res.body.ambiguous).toBe(true);
    expect(res.body.results.filter((r) => r.score === 100)).toHaveLength(2);
  });

  it("scopes results to the requested campus (multi-university isolation)", async () => {
    const f = await seedDevFixture();
    const uni = await University.create({ name: "Other University", ShortName: "OU", country: "X", state: "Y" });
    const campus = await Campus.create({ universityId: uni._id, name: "North Campus", latitude: 10, longitude: 10 });
    const b = await Building.create({ campusId: campus._id, name: "Engineering Block", latitude: 10, longitude: 10 });
    const fl = await Floor.create({ campusId: campus._id, buildingId: b._id, floorNumber: 0 });
    const room = await Room.create({ campusId: campus._id, buildingId: b._id, floorId: fl._id, name: "LT1", aliases: ["Lecture Theatre 1"] });

    const a = await search(f.campusId, "LT1");
    expect(a.body.results.map((r) => r.id)).toEqual([String(f.roomId)]);
    const o = await search(campus._id, "LT1");
    expect(o.body.results.map((r) => r.id)).toEqual([String(room._id)]);
    expect(o.body.ambiguous).toBe(false);
  });

  it("returns an empty list for gibberish and ignores inactive records", async () => {
    const f = await seedDevFixture();
    expect((await search(f.campusId, "qqqzzz")).body.results).toEqual([]);
    await Room.updateOne({ _id: f.roomId }, { isActive: false });
    expect((await search(f.campusId, "LT1")).body.results.some((r) => r.kind === "room")).toBe(false);
  });

  it("validates input", async () => {
    const f = await seedDevFixture();
    expect((await request(app).get(`${base(f.campusId)}/search`)).status).toBe(400);
    expect((await search(f.campusId, "x".repeat(101))).status).toBe(400);
    expect((await search("not-an-id", "LT1")).status).toBe(400);
    expect((await search("507f1f77bcf86cd799439011", "LT1")).status).toBe(404);
  });

  it("treats regex / operator characters as plain text", async () => {
    const f = await seedDevFixture();
    const res = await search(f.campusId, ".*");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });
});

describe("POST /campus-data/:id/locate", () => {
  const locate = (campusId, body) => request(app).post(`${base(campusId)}/locate`).send(body);

  it("reports inside / near / outside from the per-campus geofence", async () => {
    const f = await seedDevFixture();
    expect((await locate(f.campusId, { latitude: 0.0005, longitude: 0.0005 })).body.status).toBe("inside");
    const near = await locate(f.campusId, { latitude: -0.0008, longitude: 0.0005 });
    expect(near.body.status).toBe("near");
    expect(near.body.message).toMatch(/near campus/);
    const far = await locate(f.campusId, { latitude: 6.5, longitude: 3.4 });
    expect(far.body.status).toBe("outside");
    expect(far.body.message).toMatch(/away from campus/);
  });

  it("returns 'unknown' for a campus with no geofence configured (no guessing)", async () => {
    const uni = await University.create({ name: "U", ShortName: "U", country: "X", state: "Y" });
    const campus = await Campus.create({ universityId: uni._id, name: "C", latitude: 1, longitude: 1 });
    const res = await locate(campus._id, { latitude: 1, longitude: 1 });
    expect(res.body.status).toBe("unknown");
  });

  it("echoes accuracy and flags ambiguity near the boundary", async () => {
    const f = await seedDevFixture();
    const res = await locate(f.campusId, { latitude: 0.0014, longitude: 0.0005, accuracyMeters: 80 });
    expect(res.body.accuracyMeters).toBe(80);
    expect(res.body.ambiguous).toBe(true);
  });

  it("validates coordinates", async () => {
    const f = await seedDevFixture();
    expect((await locate(f.campusId, { latitude: 100, longitude: 0 })).status).toBe(400);
    expect((await locate(f.campusId, { latitude: "a", longitude: 0 })).status).toBe(400);
    expect((await locate(f.campusId, {})).status).toBe(400);
  });
});

describe("read endpoints", () => {
  it("lists buildings with entrances and omits internal searchKeys", async () => {
    const f = await seedDevFixture();
    const res = await request(app).get(`${base(f.campusId)}/buildings`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].entrances).toHaveLength(1);
    expect(res.body[0].searchKeys).toBeUndefined();
  });

  it("returns a building with floors, rooms and entrances; and a room with its floor/building", async () => {
    const f = await seedDevFixture();
    const b = await request(app).get(`${base(f.campusId)}/buildings/${f.buildingId}`);
    expect(b.body.floors).toHaveLength(1);
    expect(b.body.rooms.map((r) => r.name)).toEqual(["LT1"]);
    const r = await request(app).get(`${base(f.campusId)}/rooms/${f.roomId}`);
    expect(r.body.floor.name).toBe("Ground Floor");
    expect(r.body.building.name).toBe("Test Science Block");
    expect(r.body.entrances).toHaveLength(1);
  });

  it("404s a room asked for under the wrong campus", async () => {
    const f = await seedDevFixture();
    const uni = await University.create({ name: "U2", ShortName: "U2", country: "X", state: "Y" });
    const other = await Campus.create({ universityId: uni._id, name: "C2", latitude: 5, longitude: 5 });
    expect((await request(app).get(`${base(other._id)}/rooms/${f.roomId}`)).status).toBe(404);
  });

  it("lists landmarks", async () => {
    const f = await seedDevFixture();
    const res = await request(app).get(`${base(f.campusId)}/landmarks`);
    expect(res.body.map((l) => l.name).sort()).toEqual(["Demo Library", "Demo Main Gate"]);
  });
});
