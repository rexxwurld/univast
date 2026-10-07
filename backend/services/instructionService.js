/**
 * Turns an ordered list of path nodes into structured, human-readable walking steps.
 * Pure — no database access — so it is fully unit-testable.
 *
 * Each step keeps the original `type` / `text` / `distanceMeters` / `nodeId` fields (older clients and tests
 * rely on them) and adds what navigation needs:
 *   maneuver               vocabulary in utils/routingConstants.js (turn_left, take_stairs, enter_building, ...)
 *   durationSeconds        walking time for this step's distanceMeters at the given speed
 *   at                     { latitude, longitude } of the maneuver point
 *   geometryIndex          index of that point in the route geometry (so the app can follow progress)
 *   distanceFromStartMeters  cumulative route distance at the maneuver
 *   landmark / building / entrance / floor   context, only when the data provides it
 * `distanceMeters` is the walking distance from the PREVIOUS maneuver to this one.
 *
 * Outdoor generation with indoor connectors: edges of type stairs/ramp/elevator produce one "take_*" step per
 * run of connector edges. Nothing indoors is ever invented — if the graph has no indoor nodes there are no
 * indoor steps, only a description of where the room is.
 */
const { haversineDistance } = require("../utils/distance");
const { walkingSeconds } = require("../utils/routeMetrics");
const { VERTICAL_CONNECTOR_TYPES } = require("../utils/routingConstants");

const STRAIGHT_MAX_DEGREES = 25; // below this a node is "continue straight" (small wiggles are merged)
const SLIGHT_MAX_DEGREES = 60;
const SHARP_MIN_DEGREES = 120;
const U_TURN_MIN_DEGREES = 160;

function bearing(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x =
    Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) -
    Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Signed turn in (-180, 180]; positive = right. */
function turnAngle(fromBearing, toBearing) {
  let delta = toBearing - fromBearing;
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;
  return delta;
}

function describeTurn(angle) {
  const abs = Math.abs(angle);
  if (abs < STRAIGHT_MAX_DEGREES) return null;
  if (abs >= U_TURN_MIN_DEGREES) return "u-turn";
  const side = angle > 0 ? "right" : "left";
  if (abs < SLIGHT_MAX_DEGREES) return `slight ${side}`;
  if (abs >= SHARP_MIN_DEGREES) return `sharp ${side}`;
  return side;
}

const TURN_MANEUVER = {
  "slight left": "slight_left", "slight right": "slight_right", left: "turn_left", right: "turn_right",
  "sharp left": "sharp_left", "sharp right": "sharp_right", "u-turn": "u_turn",
};

/** Round to the nearest 5 m — false precision helps nobody on foot. */
function roundMeters(m) {
  return Math.max(5, Math.round(m / 5) * 5);
}

const labelOf = (node) => (node && ((node.name && node.name.trim()) || (node.landmark && node.landmark.trim()))) || null;
const isLandmarkLike = (node) =>
  Boolean(labelOf(node)) && (node.type === "landmark" || node.type === "poi" || Boolean(node.landmark));

function floorLabel(floor) {
  if (!floor) return null;
  if (floor.name) return floor.name;
  if (floor.floorNumber === 0) return "ground floor";
  if (Number.isFinite(floor.floorNumber)) return floor.floorNumber < 0 ? `basement level ${Math.abs(floor.floorNumber)}` : `floor ${floor.floorNumber}`;
  return null;
}

const CONNECTOR_MANEUVER = { stairs: "take_stairs", ramp: "take_ramp", elevator: "take_elevator" };
const CONNECTOR_TEXT = { stairs: "Take the stairs", ramp: "Take the ramp", elevator: "Take the elevator" };

/**
 * @param nodes        ordered path nodes [{ id, name?, type?, latitude, longitude,
 *                       landmark?: string,          name of a Landmark attached to the node
 *                       edgeType?: string,          type of the edge FROM this node to the next
 *                       distanceToNext?: number,    stored edge length (m); haversine is used when absent
 *                       floorLabel?: string }]      readable floor of the node (indoor nodes only)
 * @param start        { mode: "coordinates"|"node"|"landmark"|"entrance", snapDistanceMeters?, position?,
 *                       exit?: { buildingName, entranceName } }
 * @param destination  { kind: "room"|"building"|"entrance"|"landmark", name, buildingName?, entranceName?,
 *                       floor?, roomName?, indoorRouted?: boolean }
 * @param options      { speedMetersPerSecond?, startOffsetMeters?, indexOffset? }
 */
function generateInstructions({ nodes, start = { mode: "node" }, destination = {}, options = {} }) {
  const steps = [];
  if (!Array.isArray(nodes) || nodes.length === 0) return steps;

  const speed = options.speedMetersPerSecond;
  const indexOffset = options.indexOffset || 0;
  const startOffset = options.startOffsetMeters || 0;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];

  // ---- geometry bookkeeping ---------------------------------------------------------------------
  const segmentLengths = [];
  const segmentBearings = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const stored = nodes[i].distanceToNext;
    segmentLengths.push(
      Number.isFinite(stored) ? stored : haversineDistance(nodes[i].latitude, nodes[i].longitude, nodes[i + 1].latitude, nodes[i + 1].longitude)
    );
    segmentBearings.push(bearing(nodes[i], nodes[i + 1]));
  }
  const cumulative = [startOffset];
  for (let i = 0; i < segmentLengths.length; i += 1) cumulative.push(cumulative[i] + segmentLengths[i]);

  const point = (node) => ({ latitude: node.latitude, longitude: node.longitude });

  /** Adds a step with the structured fields filled in. */
  const push = (base, nodeIndex, extra = {}) => {
    const node = nodes[nodeIndex];
    const distanceMeters = base.distanceMeters;
    steps.push({
      ...base,
      ...(Number.isFinite(distanceMeters) ? { durationSeconds: walkingSeconds(distanceMeters, speed) } : {}),
      at: point(node),
      geometryIndex: indexOffset + nodeIndex,
      distanceFromStartMeters: Math.round(cumulative[nodeIndex] * 10) / 10,
      nodeId: node.id,
      ...extra,
    });
  };

  // ---- leaving a building ------------------------------------------------------------------------
  if (start.exit && start.exit.buildingName && start.exit.entranceName) {
    push({ type: "exit", maneuver: "exit_building", text: `Leave ${start.exit.buildingName} through ${start.exit.entranceName}.` }, 0, {
      building: start.exit.buildingName,
      entrance: start.exit.entranceName,
    });
  }

  // ---- start ---------------------------------------------------------------------------------------
  const startLabel = labelOf(first);
  if (start.mode === "coordinates") {
    const snap = start.snapDistanceMeters || 0;
    if (snap >= 15) {
      steps.push({
        type: "start",
        maneuver: "depart",
        distanceMeters: roundMeters(snap),
        durationSeconds: walkingSeconds(snap, speed),
        ...(start.position ? { at: start.position } : { at: point(first) }),
        geometryIndex: 0, // the user's own position is geometry[0]
        distanceFromStartMeters: 0,
        nodeId: first.id,
        text: `Walk about ${roundMeters(snap)} m to the nearest path${startLabel ? ` near ${startLabel}` : ""}.`,
      });
    }
  }

  // ---- along the path ------------------------------------------------------------------------------
  // Runs of connector edges (stairs/ramp/elevator) are handled as one step; no turns are computed inside them.
  const connectorEnd = new Map(); // start index -> index of the node where the run ends
  const insideConnector = new Set();
  for (let i = 0; i < nodes.length - 1; i += 1) {
    if (VERTICAL_CONNECTOR_TYPES.has(nodes[i].edgeType)) {
      let j = i + 1;
      while (j < nodes.length - 1 && nodes[j].edgeType === nodes[i].edgeType) j += 1;
      connectorEnd.set(i, j);
      for (let k = i; k <= j; k += 1) insideConnector.add(k);
      i = j - 1;
    }
  }

  if (nodes.length > 1) {
    const towards = nodes.slice(1, -1).find((n) => labelOf(n)) || (labelOf(last) ? last : null);
    const from = startLabel || "your position";
    push(
      { type: "depart", maneuver: "depart", text: towards ? `Walk from ${from} toward ${labelOf(towards)}.` : `Follow the path from ${from}.` },
      0
    );
  }

  // A route that begins ON a connector (e.g. the start node is at the foot of a staircase).
  if (connectorEnd.has(0)) {
    const kind = nodes[0].edgeType;
    const endNode = nodes[connectorEnd.get(0)];
    const toFloor = endNode.floorLabel && endNode.floorLabel !== nodes[0].floorLabel ? endNode.floorLabel : null;
    push({ type: "connector", maneuver: CONNECTOR_MANEUVER[kind], text: `${CONNECTOR_TEXT[kind]}${toFloor ? ` to the ${toFloor}` : ""}.` }, 0, toFloor ? { floor: toFloor } : {});
  }

  let run = 0; // distance walked since the last emitted instruction
  for (let k = 1; k < nodes.length - 1; k += 1) {
    run += segmentLengths[k - 1];
    const node = nodes[k];

    // Start of a stairs/ramp/elevator run: one step for the whole run.
    if (connectorEnd.has(k) && VERTICAL_CONNECTOR_TYPES.has(node.edgeType) && !VERTICAL_CONNECTOR_TYPES.has(nodes[k - 1].edgeType)) {
      const endNode = nodes[connectorEnd.get(k)];
      const kind = node.edgeType;
      const toFloor = endNode.floorLabel && endNode.floorLabel !== node.floorLabel ? endNode.floorLabel : null;
      push(
        {
          type: "connector",
          maneuver: CONNECTOR_MANEUVER[kind],
          distanceMeters: roundMeters(run),
          text: `${run >= 10 ? `After about ${roundMeters(run)} m, t` : "T"}${CONNECTOR_TEXT[kind].slice(1)}${toFloor ? ` to the ${toFloor}` : ""}.`,
        },
        k,
        toFloor ? { floor: toFloor } : {}
      );
      run = 0;
      continue;
    }
    // Indoor-routed destinations pass THROUGH the entrance node, so the "enter" step belongs there, not at the end.
    if (destination.indoorRouted && node.enters && node.enters.buildingName && node.enters.entranceName) {
      push(
        {
          type: "enter",
          maneuver: "enter_building",
          distanceMeters: roundMeters(run),
          text: `${run >= 10 ? `After about ${roundMeters(run)} m, e` : "E"}nter ${node.enters.buildingName} through ${node.enters.entranceName}.`,
        },
        k,
        { building: node.enters.buildingName, entrance: node.enters.entranceName }
      );
      run = 0;
      continue;
    }
    if (insideConnector.has(k)) {
      // Walking along the connector itself: the distance counts toward the next step, no turn/landmark here.
      continue;
    }
    if (VERTICAL_CONNECTOR_TYPES.has(nodes[k - 1].edgeType)) continue;

    const turn = describeTurn(turnAngle(segmentBearings[k - 1], segmentBearings[k]));
    const label = labelOf(node);
    const at = label ? ` at ${label}` : "";

    if (turn) {
      const phrase = turn === "u-turn" ? "make a U-turn" : `turn ${turn}`;
      const prefix = run >= 10 ? `After about ${roundMeters(run)} m, ${phrase}` : phrase.charAt(0).toUpperCase() + phrase.slice(1);
      push(
        { type: "turn", maneuver: TURN_MANEUVER[turn], distanceMeters: roundMeters(run), text: `${prefix}${at}.` },
        k,
        label ? { landmark: label } : {}
      );
      run = 0;
    } else if (isLandmarkLike(node)) {
      push(
        { type: "landmark", maneuver: "continue", distanceMeters: roundMeters(run), text: `Continue straight past ${label}.` },
        k,
        { landmark: label }
      );
      run = 0;
    }
  }

  if (nodes.length > 1) run += segmentLengths[segmentLengths.length - 1];

  // ---- arrival ---------------------------------------------------------------------------------------
  const arrivalName = destination.entranceName
    ? `${destination.buildingName ? `${destination.buildingName} ` : ""}${destination.entranceName}`
    : destination.name || labelOf(last) || "your destination";
  const lastIndex = nodes.length - 1;

  if (nodes.length > 1 && run >= 5) {
    push(
      { type: "continue", maneuver: "continue", distanceMeters: roundMeters(run), text: `Continue about ${roundMeters(run)} m to ${arrivalName}.` },
      lastIndex
    );
  }

  if (destination.kind === "room" || destination.kind === "building" || destination.kind === "entrance") {
    if (destination.buildingName && destination.entranceName) {
      push(
        { type: "enter", maneuver: "enter_building", text: `Enter ${destination.buildingName} through ${destination.entranceName}.` },
        lastIndex,
        { building: destination.buildingName, entrance: destination.entranceName }
      );
    }
    const label = floorLabel(destination.floor);
    if (destination.kind === "room" && destination.roomName && label) {
      push(
        {
          type: "destination_floor",
          maneuver: "arrive",
          text: destination.indoorRouted
            ? `${destination.roomName} is on the ${label}.`
            : `${destination.roomName} is on the ${label}. Indoor directions are not available yet.`,
        },
        lastIndex,
        { floor: label, building: destination.buildingName || undefined }
      );
    } else if (destination.kind !== "room") {
      push({ type: "arrive", maneuver: "arrive", text: `You have arrived at ${destination.name || arrivalName}.` }, lastIndex);
    }
  } else {
    push({ type: "arrive", maneuver: "arrive", text: `You have arrived at ${destination.name || arrivalName}.` }, lastIndex);
  }

  return steps;
}

module.exports = { generateInstructions, bearing, turnAngle, describeTurn, roundMeters, floorLabel };
