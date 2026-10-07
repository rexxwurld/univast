const request = require("supertest");
const app = require("../app");
const University = require("../models/University");
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Landmark = require("../models/Landmark");
const Place = require("../models/Place");
const Category = require("../models/Category");
const { seedDevFixture } = require("../seeds/devFixture");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerAdmin, registerUser } = require("./fixtures");
const { searchGlobal } = require("../services/globalSearchService");

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Phase 6: Global Search", () => {
  describe("GET /api/v1/search", () => {
    it("searches across universities, campuses, buildings, rooms, and landmarks", async () => {
      const f = await seedDevFixture();
      
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "LT1" });
      
      expect(res.status).toBe(200);
      expect(res.body.query).toBe("lt1");
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0].kind).toBe("room");
      expect(res.body.results[0].name).toBe("LT1");
      expect(Number.isFinite(res.body.results[0].latitude)).toBe(true);
      expect(Number.isFinite(res.body.results[0].longitude)).toBe(true);
    });

    it("finds buildings across all campuses", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "science" });
      
      expect(res.status).toBe(200);
      expect(res.body.results.some((r) => r.kind === "building")).toBe(true);
    });

    it("finds universities by name", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "DEMO" });
      
      expect(res.status).toBe(200);
      expect(res.body.results.some((r) => r.kind === "university")).toBe(true);
    });

    it("finds campuses by name", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "demo" });
      
      expect(res.status).toBe(200);
      expect(res.body.results.some((r) => r.kind === "campus")).toBe(true);
      const campus = res.body.results.find((r) => r.kind === "campus");
      expect(campus.universityName).toBe("UNIVAST Demo University");
    });

    it("respects limit parameter", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "demo", limit: 1 });
      
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeLessThanOrEqual(1);
    });

    it("returns empty results for gibberish", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "xyzqqqzzz" });
      
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
    });

    it("requires q parameter", async () => {
      const f = await seedDevFixture();
      const res = await request(app).get("/api/v1/search");
      
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
    });

    it("returns result with campusId and universityId for buildings", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "science" });
      
      expect(res.status).toBe(200);
      const building = res.body.results.find((r) => r.kind === "building");
      expect(building).toBeDefined();
      expect(building.campusId).toBeDefined();
      expect(building.universityId).toBeDefined();
      expect(building.universityName).toBeDefined();
    });

    it("returns result with coordinates for all searchable entities", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "test" });
      
      expect(res.status).toBe(200);
      for (const result of res.body.results) {
        if (result.kind !== "university") {
          expect(result.latitude).toBeDefined();
          expect(result.longitude).toBeDefined();
        }
      }
    });

    it("searches places by name (discovery platform)", async () => {
      const f = await seedDevFixture();
      const cat = await Category.create({ name: "Restaurant", color: "#FF0000" });
      const place = await Place.create({
        name: "Campus Café",
        category: cat._id,
        location: { type: "Point", coordinates: [0, 0] },
      });

      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "café" });

      expect(res.status).toBe(200);
      expect(res.body.results.some((r) => r.kind === "place")).toBe(true);
    });

    it("ranks exact matches higher than partial matches", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "LT1" });

      expect(res.status).toBe(200);
      expect(res.body.results[0].name).toBe("LT1");
      expect(res.body.results[0].score).toBe(100);
    });

    it("handles multi-word queries with context (building + room)", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "science lt1" });

      expect(res.status).toBe(200);
      expect(res.body.results[0].kind).toBe("room");
      expect(res.body.results[0].name).toBe("LT1");
    });

    it("does not confuse rooms with similar names (no fuzzy matching on digits)", async () => {
      const f = await seedDevFixture();
      await Room.create({
        campusId: f.campusId,
        buildingId: f.buildingId,
        floorId: f.floorId,
        name: "LT2",
        type: "lecture_hall",
        aliases: ["Lecture Theatre 2"],
      });

      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "LT1" });

      expect(res.status).toBe(200);
      expect(res.body.results[0].name).toBe("LT1");
      expect(res.body.results.map((r) => r.name)).not.toContain("LT2");
    });
  });

  describe("GET /api/v1/search/candidates", () => {
    it("is not public", async () => {
      await seedDevFixture();
      const anonymous = await request(app).get("/api/v1/search/candidates");
      expect(anonymous.status).toBe(401);

      const { token } = await registerUser();
      const ordinary = await request(app).get("/api/v1/search/candidates").set("Authorization", `Bearer ${token}`);
      expect(ordinary.status).toBe(403);
    });

    it("returns the searchable projection (no raw documents) to an admin", async () => {
      await seedDevFixture();
      const { token } = await registerAdmin();
      const res = await request(app).get("/api/v1/search/candidates").set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.some((c) => c.kind === "room")).toBe(true);
      expect(res.body.results.some((c) => c.kind === "building")).toBe(true);
      expect(res.body.results.every((c) => c.doc === undefined)).toBe(true);
    });
  });

  describe("General-map (geocoder) results", () => {
    const rows = [
      { id: "osm:node:1", name: "Calabar", displayName: "Calabar, Cross River, Nigeria", category: "place", type: "city", latitude: 4.95, longitude: 8.32 },
    ];

    it("does not call the geocoder unless asked", async () => {
      await seedDevFixture();
      const geocoder = jest.fn().mockResolvedValue(rows);
      const result = await searchGlobal({ query: "LT1", geocoder });
      expect(geocoder).not.toHaveBeenCalled();
      expect(result.geo).toEqual({ requested: false, status: "skipped" });
    });

    it("puts UNIVAST results first and appends geocoder hits marked kind=geo", async () => {
      await seedDevFixture();
      const geocoder = jest.fn().mockResolvedValue(rows);
      const result = await searchGlobal({ query: "LT1", includeGeo: true, geocoder });

      expect(result.geo.status).toBe("ok");
      expect(result.results[0].kind).toBe("room");
      const last = result.results[result.results.length - 1];
      expect(last).toMatchObject({ kind: "geo", name: "Calabar", dataSource: "geocoder" });
    });

    it("still returns UNIVAST results, and says so, when the geocoder fails", async () => {
      await seedDevFixture();
      const geocoder = jest.fn().mockRejectedValue(new Error("upstream down"));
      const result = await searchGlobal({ query: "LT1", includeGeo: true, geocoder });

      expect(result.geo.status).toBe("unavailable");
      expect(result.results[0].name).toBe("LT1");
      expect(result.results.some((r) => r.kind === "geo")).toBe(false);
    });

    it("returns general places when UNIVAST has no match at all", async () => {
      await seedDevFixture();
      const geocoder = jest.fn().mockResolvedValue(rows);
      const result = await searchGlobal({ query: "Calabar town", includeGeo: true, geocoder });
      expect(result.results.map((r) => r.kind)).toContain("geo");
    });

    it("accepts geo=1 on the HTTP endpoint without breaking normal search", async () => {
      await seedDevFixture();
      process.env.GEOCODER_SEARCH_ENABLED = "false";
      try {
        const res = await request(app).get("/api/v1/search").query({ q: "LT1", geo: "1", lat: "4.95", lng: "8.32" });
        expect(res.status).toBe(200);
        expect(res.body.results[0].name).toBe("LT1");
        expect(res.body.geo).toEqual({ requested: true, status: "disabled" });
      } finally {
        delete process.env.GEOCODER_SEARCH_ENABLED;
      }
    });
  });

  describe("Campus context and check-in state", () => {
    it("returns global search results without requiring campus selection", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "demo" });

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
    });

    it("includes dataSource and verification status in results", async () => {
      const f = await seedDevFixture();
      const res = await request(app)
        .get("/api/v1/search")
        .query({ q: "LT1" });

      expect(res.status).toBe(200);
      const result = res.body.results[0];
      expect(result.dataSource).toBeDefined();
    });
  });
});
