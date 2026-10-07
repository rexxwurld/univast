const request = require("supertest");
const app = require("../app");

afterEach(() => {
  jest.restoreAllMocks();
});

function mockNominatim(body, ok = true, status = 200) {
  return jest.spyOn(global, "fetch").mockResolvedValue({ ok, status, json: async () => body });
}

// The geocoder keeps a module-level cache keyed by coordinate, so every test
// uses its own coordinates.
describe("GET /api/v1/geocode/reverse", () => {
  it("validates lat and lng", async () => {
    expect((await request(app).get("/api/v1/geocode/reverse")).status).toBe(400);
    expect((await request(app).get("/api/v1/geocode/reverse?lat=95&lng=10")).status).toBe(400);
    expect((await request(app).get("/api/v1/geocode/reverse?lat=10&lng=190")).status).toBe(400);
    expect((await request(app).get("/api/v1/geocode/reverse?lat=abc&lng=10")).status).toBe(400);
  });

  it("returns the address from Nominatim", async () => {
    const spy = mockNominatim({ display_name: "Calabar, Nigeria", address: { city: "Calabar" } });

    const res = await request(app).get("/api/v1/geocode/reverse?lat=4.9501&lng=8.3201");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ displayName: "Calabar, Nigeria", address: { city: "Calabar" } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].headers["User-Agent"]).toBeTruthy();
  });

  it("serves repeat lookups for the same spot from cache", async () => {
    const spy = mockNominatim({ display_name: "Somewhere", address: {} });

    await request(app).get("/api/v1/geocode/reverse?lat=5.1111&lng=7.2222");
    await request(app).get("/api/v1/geocode/reverse?lat=5.1111&lng=7.2222");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when OSM has nothing for the coordinate", async () => {
    mockNominatim({ error: "Unable to geocode" });
    const res = await request(app).get("/api/v1/geocode/reverse?lat=0.0001&lng=-30.0001");
    expect(res.status).toBe(404);
  });

  it("returns 502 when the upstream service fails", async () => {
    mockNominatim({}, false, 503);
    const res = await request(app).get("/api/v1/geocode/reverse?lat=6.3333&lng=6.4444");
    expect(res.status).toBe(502);
  });
});
