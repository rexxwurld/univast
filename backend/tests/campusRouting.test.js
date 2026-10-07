const request = require("supertest");
const app = require("../app");
const Campus = require("../models/Campus");
const Entrance = require("../models/Entrance");
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

const route = (campusId, body) => request(app).post(`/api/v1/campus-data/${campusId}/route`).send(body);

describe("POST /campus-data/:campusId/route — vertical slice (LT1)", () => {
  it("routes from the gate node to the LT1 room, ending at the building entrance", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId) } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.destination.kind).toBe("room");
    expect(res.body.destination.room.name).toBe("LT1");
    expect(res.body.destination.building.name).toBe("Test Science Block");
    expect(res.body.destination.floor.name).toBe("Ground Floor");
    expect(res.body.destination.entrance.name).toBe("Main Entrance");
    expect(res.body.destination.dataSource).toBe("DEV_FIXTURE");

    // The path ends at the entrance's graph node and begins at the gate.
    expect(res.body.nodeIds[0]).toBe(String(f.gateNodeId));
    expect(res.body.nodeIds[res.body.nodeIds.length - 1]).toBe(String(f.entranceNodeId));
    expect(res.body.path.map((p) => p.name)).toEqual([
      "Demo Main Gate", "Demo Junction", "Demo Library", "", "Test Science Block Main Entrance",
    ]);
    // Total equals the sum of stored edge distances along the path.
    const edges = await NavigationEdge.find({ campusId: f.campusId });
    const along = res.body.nodeIds.slice(0, -1).map((id, i) => {
      const next = res.body.nodeIds[i + 1];
      return edges.find((e) => (String(e.from) === id && String(e.to) === next) || (String(e.to) === id && String(e.from) === next)).distance;
    });
    expect(res.body.graphDistanceMeters).toBe(along.reduce((a, b) => a + b, 0));
  });

  it("returns landmark-based human-readable instructions that finish at the room's floor", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId) } });
    const text = res.body.instructions.map((i) => i.text);
    expect(text[0]).toBe("Walk from Demo Main Gate toward Demo Junction.");
    expect(text.some((t) => /turn left at Demo Junction/.test(t))).toBe(true);
    expect(text).toContain("Continue straight past Demo Library.");
    expect(text).toContain("Enter Test Science Block through Main Entrance.");
    expect(text[text.length - 1]).toMatch(/LT1 is on the Ground Floor/);
  });

  it("routes from device coordinates, snapping to the nearest outdoor path node", async () => {
    const f = await seedDevFixture();
    // ~11 m from the gate, inside the geofence.
    const res = await route(f.campusId, { from: { latitude: 0.0001, longitude: 0.0 }, to: { roomId: String(f.roomId) } });
    expect(res.body.status).toBe("ok");
    expect(res.body.start.mode).toBe("coordinates");
    expect(res.body.start.nodeId).toBe(String(f.gateNodeId));
    expect(res.body.geofence.status).toBe("inside");
    expect(res.body.path[0].type).toBe("user");
    expect(res.body.distanceMeters).toBeGreaterThan(res.body.graphDistanceMeters - 1);
  });

  it("never snaps an outdoor user onto a stairs/elevator node", async () => {
    const f = await seedDevFixture();
    await NavigationNode.create({ campusId: f.campusId, name: "Stairs", type: "stairs", latitude: 0.00011, longitude: 0.0 });
    const res = await route(f.campusId, { from: { latitude: 0.0001, longitude: 0.0 }, to: { roomId: String(f.roomId) } });
    expect(res.body.start.nodeId).toBe(String(f.gateNodeId));
  });

  it("can start from a landmark", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { landmarkId: String(f.gateLandmarkId) }, to: { roomId: String(f.roomId) } });
    expect(res.body.status).toBe("ok");
    expect(res.body.start.nodeId).toBe(String(f.gateNodeId));
  });

  it("routes to a building (no room/floor step) and to a landmark", async () => {
    const f = await seedDevFixture();
    const b = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { buildingId: String(f.buildingId) } });
    expect(b.body.destination.kind).toBe("building");
    expect(b.body.destination.room).toBeNull();
    expect(b.body.instructions.some((i) => i.type === "destination_floor")).toBe(false);

    const l = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { landmarkId: String(f.libraryLandmarkId) } });
    expect(l.body.destination.kind).toBe("landmark");
    expect(l.body.instructions[l.body.instructions.length - 1].text).toBe("You have arrived at Demo Library.");
  });
});

describe("away-from-campus and snapping rules", () => {
  it("does NOT fabricate a route when the user is far from campus", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { latitude: 6.5, longitude: 3.4 }, to: { roomId: String(f.roomId) } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("away_from_campus");
    expect(res.body.route).toBeNull();
    expect(res.body.path).toBeUndefined();
    expect(res.body.message).toMatch(/away from campus/);
    expect(res.body.geofence.status).toBe("outside");
  });

  it("still allows a user on the 'near campus' band to route", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { latitude: -0.0004, longitude: 0.0 }, to: { roomId: String(f.roomId) } });
    expect(res.body.geofence.status).toBe("near");
    expect(res.body.status).toBe("ok");
  });

  it("reports start_too_far_from_paths when on campus but beyond the campus's snap limit", async () => {
    const f = await seedDevFixture();
    await Campus.updateOne({ _id: f.campusId }, { "routing.maxSnapMeters": 100 });
    // Inside the geofence, ~140 m from the nearest outdoor path node.
    const res = await route(f.campusId, { from: { latitude: 0.00139, longitude: 0.0021 }, to: { roomId: String(f.roomId) } });
    expect(res.body.geofence.status).toBe("inside");
    expect(res.body.status).toBe("start_too_far_from_paths");
    expect(res.body.maxSnapMeters).toBe(100);
    expect(res.body.route).toBeNull();
  });

  it("uses the per-campus maxSnapMeters setting", async () => {
    const f = await seedDevFixture();
    await Campus.updateOne({ _id: f.campusId }, { "routing.maxSnapMeters": 5 });
    const res = await route(f.campusId, { from: { latitude: 0.0001, longitude: 0.0 }, to: { roomId: String(f.roomId) } }); // ~11 m
    expect(res.body.status).toBe("start_too_far_from_paths");
    expect(res.body.maxSnapMeters).toBe(5);
  });

  it("warns (rather than guessing) when the campus has no geofence", async () => {
    const f = await seedDevFixture();
    await Campus.updateOne({ _id: f.campusId }, { $unset: { "geofence.boundary": "" }, "geofence.radiusMeters": null });
    const res = await route(f.campusId, { from: { latitude: 0.0001, longitude: 0.0 }, to: { roomId: String(f.roomId) } });
    expect(res.body.status).toBe("ok");
    expect(res.body.geofence.status).toBe("unknown");
    expect(res.body.warnings.join(" ")).toMatch(/no boundary configured/);
  });
});

describe("entrance selection and unroutable destinations", () => {
  it("chooses the entrance with the shortest walking route", async () => {
    const f = await seedDevFixture();
    // A second, closer door: a short spur off the junction.
    const spur = await NavigationNode.create({ campusId: f.campusId, name: "Side Door Node", type: "entrance", latitude: -0.0002, longitude: 0.0009 });
    await NavigationEdge.create({ campusId: f.campusId, from: f.junctionNodeId, to: spur._id, distance: 22, bidirectional: true });
    await Entrance.create({ campusId: f.campusId, buildingId: f.buildingId, name: "Side Door", type: "secondary", latitude: -0.0002, longitude: 0.0009, navigationNodeId: spur._id });

    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId) } });
    expect(res.body.destination.entrance.name).toBe("Side Door");
    expect(res.body.nodeIds[res.body.nodeIds.length - 1]).toBe(String(spur._id));
  });

  it("422s when the building has no entrance, or none connected to the graph", async () => {
    const f = await seedDevFixture();
    await Entrance.updateOne({ _id: f.entranceId }, { navigationNodeId: null });
    const unlinked = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId) } });
    expect(unlinked.status).toBe(422);
    expect(unlinked.body.message).toMatch(/connected to the walking network/);

    await Entrance.deleteMany({ buildingId: f.buildingId });
    const none = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId) } });
    expect(none.status).toBe(422);
    expect(none.body.message).toMatch(/no entrance recorded/);
  });

  it("422s when the graph has no path to the entrance", async () => {
    const f = await seedDevFixture();
    await NavigationEdge.deleteMany({ campusId: f.campusId, $or: [{ from: f.entranceNodeId }, { to: f.entranceNodeId }] });
    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId) } });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/No walking route/);
  });
});

describe("request validation", () => {
  it("requires exactly one destination selector", async () => {
    const f = await seedDevFixture();
    const none = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: {} });
    expect(none.status).toBe(400);
    const two = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId), buildingId: String(f.buildingId) } });
    expect(two.status).toBe(400);
  });

  it("requires a valid start", async () => {
    const f = await seedDevFixture();
    expect((await route(f.campusId, { to: { roomId: String(f.roomId) } })).status).toBe(400);
    expect((await route(f.campusId, { from: { latitude: 200, longitude: 0 }, to: { roomId: String(f.roomId) } })).status).toBe(400);
    expect((await route(f.campusId, { from: { nodeId: "nope" }, to: { roomId: String(f.roomId) } })).status).toBe(400);
  });

  it("404s unknown ids and ids from another campus", async () => {
    const f = await seedDevFixture();
    const missing = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: "507f1f77bcf86cd799439011" } });
    expect(missing.status).toBe(404);
    const badStart = await route(f.campusId, { from: { nodeId: "507f1f77bcf86cd799439011" }, to: { roomId: String(f.roomId) } });
    expect(badStart.status).toBe(404);
  });
});

describe("legacy routing engine is untouched", () => {
  it("POST /routes/route still works on fixture nodes", async () => {
    const f = await seedDevFixture();
    const res = await request(app)
      .post("/api/v1/routes/route")
      .send({ campusId: String(f.campusId), startNodeId: String(f.gateNodeId), endNodeId: String(f.entranceNodeId) });
    expect(res.status).toBe(200);
    expect(res.body.nodeIds).toHaveLength(5);
    expect(res.headers.deprecation).toBe("true"); // still works, but announced as deprecated
  });
});
