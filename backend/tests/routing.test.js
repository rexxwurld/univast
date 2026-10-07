const request = require("supertest");
const app = require("../app");
const University = require("../models/University");
const Campus = require("../models/Campus");
const NavigationNode = require("../models/NavigationNode");
const NavigationEdge = require("../models/NavigationEdge");
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

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/**
 *   gate --100m-- library --100m-- lab        (cafe is unconnected)
 *     \________________500m________/
 */
async function seedCampus() {
  const uni = await University.create({ name: "Test Uni", ShortName: "TU", country: "Nigeria", state: "Cross River" });
  const campus = await Campus.create({ universityId: uni._id, name: "Main", latitude: 4.95, longitude: 8.33 });
  const mk = (name, latitude, longitude) => NavigationNode.create({ campusId: campus._id, name, latitude, longitude });
  const [gate, library, lab, cafe] = await Promise.all([
    mk("gate", 4.95, 8.33),
    mk("library", 4.951, 8.33),
    mk("lab", 4.952, 8.33),
    mk("cafe", 4.96, 8.34),
  ]);
  const edge = (from, to, distance) =>
    NavigationEdge.create({ campusId: campus._id, from: from._id, to: to._id, distance, bidirectional: true });
  await edge(gate, library, 100);
  await edge(library, lab, 100);
  await edge(gate, lab, 500);
  return { campus, gate, library, lab, cafe };
}

describe("POST /api/v1/routes/route", () => {
  it("returns the shortest route with ordered nodes", async () => {
    const { campus, gate, lab } = await seedCampus();

    const res = await request(app)
      .post("/api/v1/routes/route")
      .send({ campusId: campus.id, startNodeId: gate.id, endNodeId: lab.id });

    expect(res.status).toBe(200);
    expect(res.body.distance).toBe(200);
    expect(res.body.nodes.map((n) => n.name)).toEqual(["gate", "library", "lab"]);
    expect(res.body.nodeIds).toHaveLength(3);
  });

  it("returns 404 when no walking route exists", async () => {
    const { campus, gate, cafe } = await seedCampus();

    const res = await request(app)
      .post("/api/v1/routes/route")
      .send({ campusId: campus.id, startNodeId: gate.id, endNodeId: cafe.id });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a node that is not on this campus", async () => {
    const { campus, gate } = await seedCampus();

    const res = await request(app)
      .post("/api/v1/routes/route")
      .send({ campusId: campus.id, startNodeId: gate.id, endNodeId: "507f1f77bcf86cd799439011" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a campus with no navigation nodes", async () => {
    const res = await request(app)
      .post("/api/v1/routes/route")
      .send({
        campusId: "507f1f77bcf86cd799439011",
        startNodeId: "507f1f77bcf86cd799439012",
        endNodeId: "507f1f77bcf86cd799439013",
      });
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed ids", async () => {
    const res = await request(app)
      .post("/api/v1/routes/route")
      .send({ campusId: "x", startNodeId: "y", endNodeId: "z" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/routes/nearest-node", () => {
  it("returns the closest node to a coordinate", async () => {
    const { campus } = await seedCampus();

    const res = await request(app)
      .post("/api/v1/routes/nearest-node")
      .send({ campusId: campus.id, latitude: 4.9519, longitude: 8.33 });

    expect(res.status).toBe(200);
    expect(res.body.node.name).toBe("lab");
    expect(res.body.distance).toBeLessThan(20);
  });

  it("requires latitude and longitude", async () => {
    const { campus } = await seedCampus();
    const res = await request(app).post("/api/v1/routes/nearest-node").send({ campusId: campus.id });
    expect(res.status).toBe(400);
  });
});

describe("Navigation graph admin CRUD", () => {
  it("lets an admin add a node and an edge, and rejects duplicates in either direction", async () => {
    const { token } = await registerAdmin();
    const { campus, gate, cafe } = await seedCampus();

    const edge = await request(app)
      .post("/api/v1/navigation-edges")
      .set(auth(token))
      .send({ campusId: campus.id, from: gate.id, to: cafe.id, distance: 300 });
    expect(edge.status).toBe(201);

    const duplicate = await request(app)
      .post("/api/v1/navigation-edges")
      .set(auth(token))
      .send({ campusId: campus.id, from: cafe.id, to: gate.id, distance: 300 });
    expect(duplicate.status).toBe(409);

    const selfLoop = await request(app)
      .post("/api/v1/navigation-edges")
      .set(auth(token))
      .send({ campusId: campus.id, from: gate.id, to: gate.id, distance: 1 });
    expect(selfLoop.status).toBe(400);
  });

  it("rejects negative distances and out-of-range coordinates", async () => {
    const { token } = await registerAdmin();
    const { campus, gate, cafe } = await seedCampus();

    const negative = await request(app)
      .post("/api/v1/navigation-edges")
      .set(auth(token))
      .send({ campusId: campus.id, from: gate.id, to: cafe.id, distance: -5 });
    expect(negative.status).toBe(400);

    const badNode = await request(app)
      .post("/api/v1/navigation")
      .set(auth(token))
      .send({ campusId: campus.id, name: "nowhere", latitude: 95, longitude: 8.33 });
    expect(badNode.status).toBe(400);
  });
});
