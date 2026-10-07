const { walkingSeconds, validSpeed, DEFAULT_WALKING_SPEED_MPS } = require("../../utils/routeMetrics");

describe("walkingSeconds", () => {
  it("is deterministic and rounds to whole seconds", () => {
    expect(walkingSeconds(134, 1.34)).toBe(100);
    expect(walkingSeconds(134, 1.34)).toBe(walkingSeconds(134, 1.34));
    expect(walkingSeconds(100, 1.34)).toBe(75);
  });
  it("is zero for zero, negative or invalid distances", () => {
    expect(walkingSeconds(0, 1.34)).toBe(0);
    expect(walkingSeconds(-5, 1.34)).toBe(0);
    expect(walkingSeconds(NaN, 1.34)).toBe(0);
  });
  it("falls back to the documented default speed when the speed is missing or invalid", () => {
    expect(validSpeed(undefined)).toBe(DEFAULT_WALKING_SPEED_MPS);
    expect(validSpeed(0)).toBe(DEFAULT_WALKING_SPEED_MPS);
    expect(validSpeed(-1)).toBe(DEFAULT_WALKING_SPEED_MPS);
    expect(walkingSeconds(134, 0)).toBe(100);
  });
  it("a faster campus speed shortens the estimate", () => {
    expect(walkingSeconds(300, 2)).toBeLessThan(walkingSeconds(300, 1));
  });
});
