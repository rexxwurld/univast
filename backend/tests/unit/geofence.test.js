const { classifyPoint, validateRing, pointInRing, hasBoundary } = require("../../utils/geofence");

// ~ 222 m x 222 m square around (0,0): lng/lat -0.001..0.001
const square = { boundary: { type: "Polygon", coordinates: [[[-0.001, -0.001], [0.001, -0.001], [0.001, 0.001], [-0.001, 0.001], [-0.001, -0.001]]] } };

describe("validateRing", () => {
  it("accepts a closed ring", () => {
    expect(validateRing(square.boundary.coordinates[0])).toEqual([]);
  });
  it("rejects too few points, unclosed rings and out-of-range positions", () => {
    expect(validateRing([[0, 0], [1, 1]]).length).toBeGreaterThan(0);
    expect(validateRing([[0, 0], [1, 0], [1, 1], [0, 1]]).length).toBeGreaterThan(0);
    expect(validateRing([[0, 0], [200, 0], [1, 1], [0, 0]]).length).toBeGreaterThan(0);
    expect(validateRing([[0, 0], ["a", 0], [1, 1], [0, 0]]).length).toBeGreaterThan(0);
  });
});

describe("pointInRing / hasBoundary", () => {
  it("detects inside and outside", () => {
    const ring = square.boundary.coordinates[0];
    expect(pointInRing(0, 0, ring)).toBe(true);
    expect(pointInRing(0.002, 0, ring)).toBe(false);
  });
  it("hasBoundary is false for missing/degenerate config", () => {
    expect(hasBoundary(undefined)).toBe(false);
    expect(hasBoundary({})).toBe(false);
    expect(hasBoundary({ boundary: { coordinates: [[[0, 0]]] } })).toBe(false);
    expect(hasBoundary(square)).toBe(true);
  });
});

describe("classifyPoint (polygon)", () => {
  const geofence = { ...square, nearBufferMeters: 300 };

  it("inside", () => {
    expect(classifyPoint(geofence, { latitude: 0, longitude: 0 }).status).toBe("inside");
  });
  it("near: outside the boundary but within the configured buffer", () => {
    // 0.002 deg lat ~ 222 m; boundary at 0.001 -> ~111 m away
    const r = classifyPoint(geofence, { latitude: 0.002, longitude: 0 });
    expect(r.status).toBe("near");
    expect(r.distanceToBoundaryMeters).toBeGreaterThan(100);
    expect(r.distanceToBoundaryMeters).toBeLessThan(125);
  });
  it("outside: beyond the buffer", () => {
    expect(classifyPoint(geofence, { latitude: 0.01, longitude: 0 }).status).toBe("outside");
  });
  it("no near band when nearBufferMeters is 0 / unset", () => {
    expect(classifyPoint(square, { latitude: 0.002, longitude: 0 }).status).toBe("outside");
  });
  it("near band is per-campus: a bigger buffer changes the answer", () => {
    const point = { latitude: 0.004, longitude: 0 };
    expect(classifyPoint({ ...square, nearBufferMeters: 100 }, point).status).toBe("outside");
    expect(classifyPoint({ ...square, nearBufferMeters: 1000 }, point).status).toBe("near");
  });
  it("flags ambiguity when GPS accuracy exceeds the distance to the boundary", () => {
    const close = classifyPoint(geofence, { latitude: 0.00105, longitude: 0, accuracyMeters: 50 });
    expect(close.ambiguous).toBe(true);
    const clear = classifyPoint(geofence, { latitude: 0, longitude: 0, accuracyMeters: 20 });
    expect(clear.ambiguous).toBe(false);
  });
});

describe("classifyPoint (radius fallback and unconfigured)", () => {
  const center = { latitude: 0, longitude: 0 };
  it("uses the circle when there is no polygon", () => {
    const geofence = { radiusMeters: 200, nearBufferMeters: 100 };
    expect(classifyPoint(geofence, { latitude: 0.001, longitude: 0 }, center).status).toBe("inside"); // ~111 m
    expect(classifyPoint(geofence, { latitude: 0.0025, longitude: 0 }, center).status).toBe("near"); // ~278 m
    expect(classifyPoint(geofence, { latitude: 0.01, longitude: 0 }, center).status).toBe("outside");
  });
  it("returns unknown — never a guess — when nothing is configured", () => {
    expect(classifyPoint({}, { latitude: 0, longitude: 0 }, center).status).toBe("unknown");
    expect(classifyPoint(undefined, { latitude: 0, longitude: 0 }, center).status).toBe("unknown");
    expect(classifyPoint({ radiusMeters: null }, { latitude: 0, longitude: 0 }, center).status).toBe("unknown");
  });
});
