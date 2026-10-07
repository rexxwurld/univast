const request = require("supertest");
const app = require("../app");
const University = require("../models/University");
const Campus = require("../models/Campus");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Landmark = require("../models/Landmark");
const Entrance = require("../models/Entrance");
const NavigationNode = require("../models/NavigationNode");
const NavigationEdge = require("../models/NavigationEdge");
const { seedDevFixture } = require("../seeds/devFixture");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerAdmin } = require("./fixtures");

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
const fromGateToRoom = (f) => ({ from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId) } });
const edge = (f, a, b, extra = {}) => NavigationEdge.create({ campusId: f.campusId, from: a, to: b, distance: 10, bidirectional: true, ...extra });
const node = (f, name, type, latitude, longitude, extra = {}) => NavigationNode.create({ campusId: f.campusId, name, type, latitude, longitude, ...extra });

async function otherCampus(name = "Other Campus") {
  const uni = await University.create({ name: `${name} University`, ShortName: "OU", country: "X", state: "Y" });
  return Campus.create({ universityId: uni._id, name, latitude: 5, longitude: 5 });
}

describe("structured route response", () => {
  it("returns campus, origin, distance, duration, geometry, steps and metadata", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, fromGateToRoom(f));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.campus).toEqual({ id: String(f.campusId), name: "Main Campus" });
    expect(res.body.origin.kind).toBe("node");
    expect(res.body.origin.nodeId).toBe(String(f.gateNodeId));
    expect(res.body.origin.name).toBe("Demo Main Gate");
    expect(res.body.durationSeconds).toBe(Math.round(res.body.distanceMeters / 1.34));
    expect(res.body.metadata.walkingSpeedMetersPerSecond).toBe(1.34);
    expect(res.body.metadata.indoorRouting).toBe("not_available");
    expect(res.body.metadata.accessibleOnly).toBe(false);
    expect(typeof res.body.metadata.graphVersion).toBe("string");
  });

  it("geometry follows the graph nodes in order (no straight line through buildings) as [lng, lat]", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, fromGateToRoom(f));

    expect(res.body.geometry.type).toBe("LineString");
    expect(res.body.geometry.coordinates).toEqual([
      [0, 0],
      [0.0009, 0],
      [0.0009, 0.0005],
      [0.0009, 0.001],
      [0.0004, 0.001],
    ]);
  });

  it("starts the geometry at the user's real position when the route starts from coordinates", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { latitude: 0.0001, longitude: 0.0 }, to: { roomId: String(f.roomId) } });

    expect(res.body.geometry.coordinates[0]).toEqual([0, 0.0001]);
    expect(res.body.geometry.coordinates).toHaveLength(6);
    expect(res.body.origin.kind).toBe("device");
    expect(res.body.origin.latitude).toBe(0.0001);
    expect(res.body.origin.snapDistanceMeters).toBeGreaterThan(5);
  });

  it("steps carry maneuver, position, geometry index and monotonic cumulative distance; the last step is 'arrive'", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, fromGateToRoom(f));
    const { steps, geometry } = res.body;

    expect(steps[0].maneuver).toBe("depart");
    expect(steps[steps.length - 1].maneuver).toBe("arrive");
    let previous = -1;
    for (const step of steps) {
      expect(step.at).toBeTruthy();
      expect(step.geometryIndex).toBeLessThan(geometry.coordinates.length);
      expect(step.distanceFromStartMeters).toBeGreaterThan(previous - 0.001);
      previous = step.distanceFromStartMeters;
    }
    const turn = steps.find((s) => s.maneuver === "turn_left");
    expect(turn.landmark).toBe("Demo Junction");
    expect(turn.durationSeconds).toBeGreaterThan(0);
    expect(res.body.instructions.map((i) => i.text)).toEqual(steps.map((s) => s.text));
  });

  it("separates the outdoor route from indoor guidance and does not pretend indoor routing exists", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, fromGateToRoom(f));

    expect(res.body.destination.indoor).toEqual({
      routed: false,
      floor: { id: String(f.floorId), floorNumber: 0, name: "Ground Floor" },
      description: "LT1 is on the Ground Floor.",
    });
    expect(res.body.destination.position).toEqual({ latitude: 0.001, longitude: 0.0004 }); // the entrance
    const text = res.body.steps.map((s) => s.text);
    expect(text).toContain("Enter Test Science Block through Main Entrance.");
    expect(text[text.length - 1]).toMatch(/Indoor directions are not available yet/);
  });

  it("uses the campus's own walking speed and exposes its navigation settings in metadata", async () => {
    const f = await seedDevFixture();
    const base = await route(f.campusId, fromGateToRoom(f));
    await Campus.updateOne(
      { _id: f.campusId },
      { "routing.walkingSpeedMetersPerSecond": 2.68, "routing.rerouteDeviationMeters": 45, "routing.rerouteMinIntervalSeconds": 20, "routing.arrivalRadiusMeters": 12 }
    );

    const fast = await route(f.campusId, fromGateToRoom(f));

    expect(fast.body.durationSeconds).toBe(Math.round(fast.body.distanceMeters / 2.68));
    expect(fast.body.durationSeconds).toBeLessThan(base.body.durationSeconds);
    expect(fast.body.metadata).toEqual(expect.objectContaining({ rerouteDeviationMeters: 45, rerouteMinIntervalSeconds: 20, arrivalRadiusMeters: 12 }));
    expect(base.body.metadata.rerouteDeviationMeters).toBe(30);
  });

  it("describes landmarks attached to graph nodes in the steps", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, fromGateToRoom(f));
    expect(res.body.steps.some((s) => s.text === "Continue straight past Demo Library." && s.landmark === "Demo Library")).toBe(true);
  });
});

describe("origins and destinations", () => {
  it("routes from an entrance and tells the user to leave the building", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { entranceId: String(f.entranceId) }, to: { landmarkId: String(f.gateLandmarkId) } });

    expect(res.status).toBe(200);
    expect(res.body.origin.kind).toBe("entrance");
    expect(res.body.steps[0].maneuver).toBe("exit_building");
    expect(res.body.steps[0].text).toBe("Leave Test Science Block through Main Entrance.");
    expect(res.body.nodeIds[0]).toBe(String(f.entranceNodeId));
  });

  it("routes to an entrance directly", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { entranceId: String(f.entranceId) } });
    expect(res.body.status).toBe("ok");
    expect(res.body.destination.kind).toBe("entrance");
    expect(res.body.nodeIds[res.body.nodeIds.length - 1]).toBe(String(f.entranceNodeId));
  });

  it("a selected map point outside the campus gets its own honest message", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { latitude: 6.5, longitude: 3.4, source: "map" }, to: { roomId: String(f.roomId) } });
    expect(res.body.status).toBe("away_from_campus");
    expect(res.body.message).toMatch(/That point is outside this campus/);
  });

  it("the device-location message is unchanged", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { from: { latitude: 6.5, longitude: 3.4 }, to: { roomId: String(f.roomId) } });
    expect(res.body.message).toMatch(/currently away from campus/);
  });

  it("an entrance that is not connected to the graph cannot be an origin", async () => {
    const f = await seedDevFixture();
    await Entrance.updateOne({ _id: f.entranceId }, { navigationNodeId: null });
    const res = await route(f.campusId, { from: { entranceId: String(f.entranceId) }, to: { landmarkId: String(f.gateLandmarkId) } });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ENTRANCE_NOT_ROUTABLE");
  });
});

describe("campus isolation and validation", () => {
  it("rejects origins and destinations that belong to another campus (never trusts client ids)", async () => {
    const f = await seedDevFixture();
    const other = await otherCampus();
    const foreignNode = await NavigationNode.create({ campusId: other._id, name: "far", type: "intersection", latitude: 5, longitude: 5 });

    const badNode = await route(f.campusId, { from: { nodeId: String(foreignNode._id) }, to: { roomId: String(f.roomId) } });
    expect(badNode.status).toBe(404);
    expect(badNode.body.code).toBe("ORIGIN_NOT_FOUND");

    const badRoom = await route(other._id, { from: { nodeId: String(foreignNode._id) }, to: { roomId: String(f.roomId) } });
    expect(badRoom.status).toBe(404);
    expect(badRoom.body.code).toBe("DESTINATION_NOT_FOUND");

    const badLandmark = await route(other._id, { from: { landmarkId: String(f.gateLandmarkId) }, to: { buildingId: String(f.buildingId) } });
    expect(badLandmark.status).toBe(404);
    const badEntrance = await route(other._id, { from: { entranceId: String(f.entranceId) }, to: { buildingId: String(f.buildingId) } });
    expect(badEntrance.status).toBe(404);
  });

  it("returns stable error codes for the main failure states", async () => {
    const f = await seedDevFixture();
    const missing = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: "507f1f77bcf86cd799439011" } });
    expect(missing.body.code).toBe("DESTINATION_NOT_FOUND");

    const unknownCampus = await route("507f1f77bcf86cd799439011", fromGateToRoom(f));
    expect(unknownCampus.status).toBe(404);

    await Entrance.updateOne({ _id: f.entranceId }, { navigationNodeId: null });
    const unlinked = await route(f.campusId, fromGateToRoom(f));
    expect(unlinked.status).toBe(422);
    expect(unlinked.body.code).toBe("DESTINATION_NOT_ROUTABLE");
  });

  it("reports NO_ROUTE for a disconnected graph", async () => {
    const f = await seedDevFixture();
    await NavigationEdge.deleteMany({ campusId: f.campusId, $or: [{ from: f.entranceNodeId }, { to: f.entranceNodeId }] });
    const res = await route(f.campusId, fromGateToRoom(f));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NO_ROUTE");
  });

  it("rejects malformed requests with 400 and never routes them", async () => {
    const f = await seedDevFixture();
    const gate = String(f.gateNodeId);
    const room = String(f.roomId);
    const bad = [
      {},
      { from: { nodeId: gate } },
      { to: { roomId: room } },
      { from: { nodeId: gate, landmarkId: String(f.gateLandmarkId) }, to: { roomId: room } }, // two kinds of origin
      { from: { latitude: 0.0001 }, to: { roomId: room } },
      { from: { latitude: 91, longitude: 0 }, to: { roomId: room } },
      { from: { nodeId: "nope" }, to: { roomId: room } },
      { from: { nodeId: gate }, to: { roomId: room }, options: { accessibleOnly: "yes" } },
    ];
    for (const body of bad) {
      const res = await route(f.campusId, body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
    }
    const noDestination = await route(f.campusId, { from: { nodeId: gate }, to: {} });
    expect(noDestination.status).toBe(400);
    expect(noDestination.body.code).toBe("INVALID_REQUEST");
  });
});

describe("walking metadata on edges", () => {
  it("never routes through a restricted edge, and reports how many were ignored", async () => {
    const f = await seedDevFixture();
    const shortcut = await edge(f, f.gateNodeId, f.entranceNodeId, { distance: 20, isRestricted: true });

    const res = await route(f.campusId, fromGateToRoom(f));

    expect(res.body.nodeIds).toHaveLength(5); // the long, legal way round
    expect(res.body.metadata.edgesIgnored.restricted).toBe(1);

    await NavigationEdge.updateOne({ _id: shortcut._id }, { isRestricted: false });
    const open = await route(f.campusId, fromGateToRoom(f));
    expect(open.body.nodeIds).toHaveLength(2);
    expect(open.body.distanceMeters).toBe(20);
  });

  it("a restricted edge that is the only connection means there is no route", async () => {
    const f = await seedDevFixture();
    await NavigationEdge.updateOne({ campusId: f.campusId, from: f.junctionNodeId, to: f.libraryNodeId }, { isRestricted: true });
    const res = await route(f.campusId, fromGateToRoom(f));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NO_ROUTE");
  });

  it("accessible-only routing avoids stairs and explicitly inaccessible edges", async () => {
    const f = await seedDevFixture();
    await edge(f, f.gateNodeId, f.entranceNodeId, { distance: 20, type: "stairs" });

    const normal = await route(f.campusId, fromGateToRoom(f));
    const accessible = await route(f.campusId, { ...fromGateToRoom(f), options: { accessibleOnly: true } });

    expect(normal.body.nodeIds).toHaveLength(2);
    expect(accessible.body.nodeIds).toHaveLength(5);
    expect(accessible.body.metadata.accessibleOnly).toBe(true);
    expect(accessible.body.metadata.edgesIgnored.inaccessible).toBe(1);
  });

  it("edges with unknown accessibility stay usable for accessible-only routing", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, { ...fromGateToRoom(f), options: { accessibleOnly: true } });
    expect(res.body.status).toBe("ok");
  });

  it("edges created before Phase 5 (no type/flags stored) behave as plain paths", async () => {
    const f = await seedDevFixture();
    await NavigationEdge.collection.updateMany({}, { $unset: { type: "", isAccessible: "", isRestricted: "" } });
    require("../services/graphCache").invalidate();
    const res = await route(f.campusId, fromGateToRoom(f));
    expect(res.body.status).toBe("ok");
    expect(res.body.metadata.edgesIgnored).toEqual({ restricted: 0, inaccessible: 0, invalidFloorTransition: 0 });
  });
});

describe("indoor rooms and floor transitions", () => {
  /** Adds an indoor graph: entrance -> lobby (ground) -> stairs foot (ground) -> stairs top (first) -> LT2 (first). */
  async function addIndoorGraph(f, { stairsType = "stairs" } = {}) {
    const first = await Floor.create({ campusId: f.campusId, buildingId: f.buildingId, floorNumber: 1, name: "First Floor" });
    const lobby = await node(f, "", "intersection", 0.001, 0.00035, { floorId: f.floorId, buildingId: f.buildingId });
    const foot = await node(f, "", "stairs", 0.001, 0.0003, { floorId: f.floorId, buildingId: f.buildingId });
    const top = await node(f, "", "stairs", 0.001, 0.0003, { floorId: first._id, buildingId: f.buildingId });
    const roomNode = await node(f, "LT2", "poi", 0.001, 0.0002, { floorId: first._id, buildingId: f.buildingId });
    await edge(f, f.entranceNodeId, lobby._id, { distance: 6 });
    await edge(f, lobby._id, foot._id, { distance: 6 });
    await edge(f, foot._id, top._id, { distance: 8, type: stairsType });
    await edge(f, top._id, roomNode._id, { distance: 12 });
    const room = await Room.create({
      campusId: f.campusId, buildingId: f.buildingId, floorId: first._id, name: "LT2", type: "lecture_hall",
      aliases: ["Lecture Theatre 2"], navigationNodeId: roomNode._id,
    });
    return { first, lobby, foot, top, roomNode, room };
  }

  it("routes through the entrance and up the stairs when the room has an indoor node", async () => {
    const f = await seedDevFixture();
    const { room, roomNode } = await addIndoorGraph(f);

    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(room._id) } });

    expect(res.status).toBe(200);
    expect(res.body.nodeIds[res.body.nodeIds.length - 1]).toBe(String(roomNode._id));
    expect(res.body.metadata.indoorRouting).toBe("routed");
    expect(res.body.destination.indoor.routed).toBe(true);
    const text = res.body.steps.map((s) => s.text);
    expect(text.some((t) => /enter Test Science Block through Main Entrance/i.test(t))).toBe(true);
    const stairs = res.body.steps.find((s) => s.maneuver === "take_stairs");
    expect(stairs.floor).toBe("First Floor");
    expect(stairs.text).toMatch(/take the stairs to the First Floor/i);
    expect(text[text.length - 1]).toBe("LT2 is on the First Floor.");
    expect(res.body.steps.filter((s) => s.maneuver === "enter_building")).toHaveLength(1);
  });

  it("an elevator or ramp connector is accepted, and accessible-only skips the stairs but not the elevator", async () => {
    const f = await seedDevFixture();
    const { room } = await addIndoorGraph(f, { stairsType: "stairs" });
    const blocked = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(room._id) }, options: { accessibleOnly: true } });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("INDOOR_UNREACHABLE");
  });

  it("with an elevator the accessible-only route succeeds and says 'elevator'", async () => {
    const f = await seedDevFixture();
    const { room } = await addIndoorGraph(f, { stairsType: "elevator" });
    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(room._id) }, options: { accessibleOnly: true } });
    expect(res.status).toBe(200);
    expect(res.body.steps.find((s) => s.maneuver === "take_elevator").text).toMatch(/take the elevator/i);
  });

  it("a plain path between floors is invalid data: it is ignored and the room is unreachable", async () => {
    const f = await seedDevFixture();
    const { room } = await addIndoorGraph(f, { stairsType: "path" });

    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(room._id) } });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INDOOR_UNREACHABLE");
    expect(res.body.message).toMatch(/Stairs, ramps or elevators/);
  });

  it("a room whose indoor node is on another campus is rejected, never routed", async () => {
    const f = await seedDevFixture();
    const other = await otherCampus();
    const foreign = await NavigationNode.create({ campusId: other._id, name: "x", type: "poi", latitude: 5, longitude: 5 });
    const bad = await Room.create({ campusId: f.campusId, buildingId: f.buildingId, floorId: f.floorId, name: "Odd", navigationNodeId: foreign._id });

    const res = await route(f.campusId, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(bad._id) } });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ROOM_NODE_MISSING");
  });

  it("indoor nodes are never used to snap an outdoor position onto the graph", async () => {
    const f = await seedDevFixture();
    await addIndoorGraph(f);
    const res = await route(f.campusId, { from: { latitude: 0.001, longitude: 0.0003 }, to: { landmarkId: String(f.gateLandmarkId) } });
    // The point is right on top of the (indoor) stairs, yet the start snaps to an outdoor node.
    expect(["intersection", "entrance", "landmark"]).toContain(res.body.path[1].type);
  });

  it("the admin API refuses an indoor node from another campus and accepts one from its own", async () => {
    const f = await seedDevFixture();
    const other = await otherCampus();
    const foreign = await NavigationNode.create({ campusId: other._id, name: "x", type: "poi", latitude: 5, longitude: 5 });
    const { token } = await registerAdmin();
    const url = `/api/v1/campus-data/${f.campusId}/rooms/${f.roomId}`;

    const bad = await request(app).patch(url).set({ Authorization: `Bearer ${token}` }).send({ navigationNodeId: String(foreign._id) });
    expect(bad.status).toBe(400);
    const good = await request(app).patch(url).set({ Authorization: `Bearer ${token}` }).send({ navigationNodeId: String(f.entranceNodeId) });
    expect(good.status).toBe(200);
    expect(String(good.body.navigationNodeId)).toBe(String(f.entranceNodeId));
  });
});

describe("graph cache", () => {
  it("is invalidated when an edge is added, so a new shortcut is used immediately", async () => {
    const f = await seedDevFixture();
    const before = await route(f.campusId, fromGateToRoom(f));
    const again = await route(f.campusId, fromGateToRoom(f));
    expect(again.body.metadata.graphVersion).toBe(before.body.metadata.graphVersion); // stable while nothing changes

    await edge(f, f.gateNodeId, f.entranceNodeId, { distance: 20 });
    const after = await route(f.campusId, fromGateToRoom(f));

    expect(after.body.distanceMeters).toBe(20);
    expect(after.body.metadata.graphVersion).not.toBe(before.body.metadata.graphVersion);
  });

  it("is invalidated by deletes and by updates made through query helpers", async () => {
    const f = await seedDevFixture();
    const shortcut = await edge(f, f.gateNodeId, f.entranceNodeId, { distance: 20 });
    expect((await route(f.campusId, fromGateToRoom(f))).body.distanceMeters).toBe(20);

    await NavigationEdge.findByIdAndUpdate(shortcut._id, { distance: 30 });
    expect((await route(f.campusId, fromGateToRoom(f))).body.distanceMeters).toBe(30);

    await NavigationEdge.deleteOne({ _id: shortcut._id });
    expect((await route(f.campusId, fromGateToRoom(f))).body.nodeIds).toHaveLength(5);
  });

  it("keeps campuses separate", async () => {
    const f = await seedDevFixture();
    const other = await otherCampus();
    await route(f.campusId, fromGateToRoom(f));
    const res = await route(other._id, { from: { nodeId: String(f.gateNodeId) }, to: { roomId: String(f.roomId) } });
    expect(res.status).toBe(404);
  });

  it("can be disabled with ROUTING_GRAPH_CACHE_SECONDS=0 (reads fresh data every time)", async () => {
    const f = await seedDevFixture();
    const previous = process.env.ROUTING_GRAPH_CACHE_SECONDS;
    process.env.ROUTING_GRAPH_CACHE_SECONDS = "0";
    try {
      await route(f.campusId, fromGateToRoom(f));
      await NavigationEdge.collection.insertOne({
        campusId: f.campusId, from: f.gateNodeId, to: f.entranceNodeId, distance: 20, bidirectional: true, type: "path", isRestricted: false,
      }); // raw write: bypasses the invalidation hooks on purpose
      expect((await route(f.campusId, fromGateToRoom(f))).body.distanceMeters).toBe(20);
    } finally {
      if (previous === undefined) delete process.env.ROUTING_GRAPH_CACHE_SECONDS;
      else process.env.ROUTING_GRAPH_CACHE_SECONDS = previous;
    }
  });
});

describe("campus settings", () => {
  it("lets an admin tune walking speed and navigation thresholds, and rejects nonsense", async () => {
    const f = await seedDevFixture();
    const { token } = await registerAdmin();
    const url = `/api/v1/campus-data/${f.campusId}/settings`;
    const ok = await request(app).patch(url).set({ Authorization: `Bearer ${token}` })
      .send({ routing: { walkingSpeedMetersPerSecond: 1.2, rerouteDeviationMeters: 40, rerouteMinIntervalSeconds: 10, arrivalRadiusMeters: 20 } });
    expect(ok.status).toBe(200);
    expect(ok.body.routing.rerouteDeviationMeters).toBe(40);

    for (const bad of [{ walkingSpeedMetersPerSecond: 0 }, { walkingSpeedMetersPerSecond: 9 }, { rerouteDeviationMeters: 1 }, { arrivalRadiusMeters: 0 }]) {
      const res = await request(app).patch(url).set({ Authorization: `Bearer ${token}` }).send({ routing: bad });
      expect([JSON.stringify(bad), res.status]).toEqual([JSON.stringify(bad), 400]);
    }
  });
});

describe("backward compatibility", () => {
  it("still returns the fields older clients read", async () => {
    const f = await seedDevFixture();
    const res = await route(f.campusId, fromGateToRoom(f));
    for (const key of ["status", "distanceMeters", "graphDistanceMeters", "start", "geofence", "warnings", "destination", "nodeIds", "path", "instructions"]) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.destination.entrance.name).toBe("Main Entrance");
  });
});
