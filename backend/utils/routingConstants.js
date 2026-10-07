/** Shared vocabulary for the campus walking graph (kept dependency-free so it is unit-testable). */

// NavigationEdge.type
const EDGE_TYPES = ["path", "road", "stairs", "ramp", "elevator"];

// Edge types that may join two different floors. An edge between nodes on different floors that is
// NOT one of these is invalid data and is ignored (with a warning) rather than routed through.
const VERTICAL_CONNECTOR_TYPES = new Set(["stairs", "ramp", "elevator"]);

// Edges a wheelchair user / "accessible only" request must avoid. Stairs are never accessible.
const NEVER_ACCESSIBLE_TYPES = new Set(["stairs"]);

// Maneuver vocabulary returned in route steps (mobile maps these to icons/wording).
const MANEUVERS = [
  "depart", "continue", "slight_left", "slight_right", "turn_left", "turn_right", "sharp_left", "sharp_right",
  "u_turn", "enter_building", "exit_building", "take_stairs", "take_ramp", "take_elevator", "arrive",
];

module.exports = { EDGE_TYPES, VERTICAL_CONNECTOR_TYPES, NEVER_ACCESSIBLE_TYPES, MANEUVERS };
