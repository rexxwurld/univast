const { haversineDistance, EARTH_RADIUS_METERS } = require("../../utils/distance");

describe("haversineDistance", () => {
  it("is zero for identical points", () => {
    expect(haversineDistance(4.95, 8.33, 4.95, 8.33)).toBe(0);
  });

  it("is symmetric", () => {
    const ab = haversineDistance(4.95, 8.33, 6.5, 3.4);
    const ba = haversineDistance(6.5, 3.4, 4.95, 8.33);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it("measures one degree of latitude as about 111.2 km", () => {
    const d = haversineDistance(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
  });

  it("measures half the globe as pi * radius", () => {
    expect(haversineDistance(0, 0, 0, 180)).toBeCloseTo(Math.PI * EARTH_RADIUS_METERS, 0);
  });

  it("measures Calabar to Lagos at roughly 500 km", () => {
    const d = haversineDistance(4.95, 8.32, 6.52, 3.38);
    expect(d / 1000).toBeGreaterThan(520);
    expect(d / 1000).toBeLessThan(580);
  });
});
