/**
 * Walking-time arithmetic. Deterministic: the same distance and speed always give the same answer.
 *
 * ASSUMPTION (documented, not measured): an average adult walking speed of 1.34 m/s (about 4.8 km/h).
 * Campuses can override it with Campus.routing.walkingSpeedMetersPerSecond. There is no live data of any
 * kind (no traffic, crowds, weather or elevation) in the estimate.
 */
const DEFAULT_WALKING_SPEED_MPS = 1.34;

function validSpeed(speed) {
  return Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_WALKING_SPEED_MPS;
}

/** Whole seconds, rounded to nearest. 0 m -> 0 s. */
function walkingSeconds(distanceMeters, speedMetersPerSecond) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  return Math.round(distanceMeters / validSpeed(speedMetersPerSecond));
}

module.exports = { DEFAULT_WALKING_SPEED_MPS, walkingSeconds, validSpeed };
