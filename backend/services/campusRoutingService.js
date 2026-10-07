/**
 * Campus routing layer. Sits ABOVE the existing, tested Dijkstra graph (utils/graph.js) — which is not modified:
 *
 *   origin (device coordinates | map point | node | landmark | entrance)
 *     -> geofence check -> nearest OUTDOOR path node (per-campus max snap distance)
 *     -> Dijkstra over the cached, filtered graph (restricted / invalid-floor / optionally inaccessible edges removed)
 *     -> destination endpoint (building entrance, landmark node, entrance, or an indoor room node when mapped)
 *     -> structured route: geometry, steps, distance, duration, metadata
 *
 * Outdoor routes end at a building ENTRANCE. A room is the destination entity; unless it has its own indoor
 * graph node (Room.navigationNodeId) it contributes floor information only — no indoor corridors are invented.
 *
 * Response statuses: "ok" | "away_from_campus" | "start_too_far_from_paths" (all HTTP 200: valid outcomes).
 * Failures are ApiErrors with a stable `code`: CAMPUS_NOT_FOUND, DESTINATION_NOT_FOUND, ORIGIN_NOT_FOUND,
 * INVALID_REQUEST, NO_NAVIGATION_GRAPH, DESTINATION_NOT_ROUTABLE, ENTRANCE_NOT_ROUTABLE, LANDMARK_NOT_ROUTABLE,
 * ROOM_NODE_MISSING, INDOOR_UNREACHABLE, NO_ROUTE.
 */
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Entrance = require("../models/Entrance");
const Landmark = require("../models/Landmark");
const ApiError = require("../utils/ApiError");
const { haversineDistance } = require("../utils/distance");
const { dijkstra } = require("../utils/graph");
const { classifyPoint } = require("../utils/geofence");
const { walkingSeconds, validSpeed, DEFAULT_WALKING_SPEED_MPS } = require("../utils/routeMetrics");
const { getRoutingGraph, pairKey } = require("./graphCache");
const { generateInstructions, floorLabel } = require("./instructionService");

// Indoor connector nodes are never a sensible place to snap an outdoor user onto.
const NON_OUTDOOR_NODE_TYPES = new Set(["stairs", "elevator"]);
const isOutdoorNode = (node) => !NON_OUTDOOR_NODE_TYPES.has(node.type) && !node.floorId;

function nearestNode(nodes, latitude, longitude) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (!isOutdoorNode(node)) continue;
    const d = haversineDistance(latitude, longitude, node.latitude, node.longitude);
    if (d < bestDistance) {
      bestDistance = d;
      best = node;
    }
  }
  return { node: best, distanceMeters: bestDistance };
}

const publicNode = (n) => ({ id: String(n._id), name: n.name || "", type: n.type, latitude: n.latitude, longitude: n.longitude });
const settingsOf = (campus) => campus.routing || {};

// ---------------------------------------------------------------------------------------------------------
// Destination
// ---------------------------------------------------------------------------------------------------------

/** Resolves the `to` selector into a destination description + candidate end nodes. */
async function resolveDestination(campusId, to) {
  const selectors = ["roomId", "buildingId", "entranceId", "landmarkId"].filter((k) => to && to[k]);
  if (selectors.length !== 1) {
    throw new ApiError(400, "to must contain exactly one of: roomId, buildingId, entranceId, landmarkId", undefined, "INVALID_REQUEST");
  }
  const [kind] = selectors;

  if (kind === "landmarkId") {
    const landmark = await Landmark.findOne({ _id: to.landmarkId, campusId }).lean();
    if (!landmark) throw new ApiError(404, "Landmark not found on this campus", undefined, "DESTINATION_NOT_FOUND");
    if (!landmark.navigationNodeId) {
      throw new ApiError(422, `Landmark '${landmark.name}' is not connected to the walking network yet`, undefined, "LANDMARK_NOT_ROUTABLE");
    }
    return {
      kind: "landmark",
      name: landmark.name,
      landmark,
      endpoints: [{ nodeId: String(landmark.navigationNodeId), label: landmark.name }],
      position: { latitude: landmark.latitude, longitude: landmark.longitude },
    };
  }

  let room = null;
  let building = null;
  let entrances = [];

  if (kind === "roomId") {
    room = await Room.findOne({ _id: to.roomId, campusId }).lean();
    if (!room) throw new ApiError(404, "Room not found on this campus", undefined, "DESTINATION_NOT_FOUND");
    building = await Building.findById(room.buildingId).lean();
  } else if (kind === "buildingId") {
    building = await Building.findOne({ _id: to.buildingId, campusId }).lean();
    if (!building) throw new ApiError(404, "Building not found on this campus", undefined, "DESTINATION_NOT_FOUND");
  } else {
    const entrance = await Entrance.findOne({ _id: to.entranceId, campusId }).lean();
    if (!entrance) throw new ApiError(404, "Entrance not found on this campus", undefined, "DESTINATION_NOT_FOUND");
    building = await Building.findById(entrance.buildingId).lean();
    entrances = [entrance];
  }
  if (!building) throw new ApiError(404, "Building for this destination not found", undefined, "DESTINATION_NOT_FOUND");

  if (entrances.length === 0) entrances = await Entrance.find({ buildingId: building._id, campusId }).lean();
  const routable = entrances.filter((e) => e.navigationNodeId);
  const floor = room ? await Floor.findById(room.floorId).lean() : null;

  // A room with its own indoor node must be reached through the graph (floors, stairs, ... included).
  if (room && room.navigationNodeId) {
    return {
      kind: "room",
      name: room.name,
      room,
      floor,
      building,
      indoor: true,
      endpoints: [{ nodeId: String(room.navigationNodeId), label: room.name, indoor: true }],
      entranceNodes: new Map(routable.map((e) => [String(e.navigationNodeId), e])),
      position: null, // filled from the room's node once the graph is loaded
    };
  }

  if (entrances.length === 0) {
    throw new ApiError(422, `Building '${building.name}' has no entrance recorded yet`, undefined, "DESTINATION_NOT_ROUTABLE");
  }
  if (routable.length === 0) {
    throw new ApiError(422, `No entrance of '${building.name}' is connected to the walking network yet`, undefined, "DESTINATION_NOT_ROUTABLE");
  }

  return {
    kind: kind === "roomId" ? "room" : kind === "entranceId" ? "entrance" : "building",
    name: room ? room.name : building.name,
    room,
    floor,
    building,
    indoor: false,
    endpoints: routable.map((e) => ({ nodeId: String(e.navigationNodeId), label: e.name, entrance: e })),
    position: null, // the chosen entrance's position
  };
}

// ---------------------------------------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------------------------------------

async function resolveOrigin({ campus, from, graph }) {
  const hasCoordinates = from && Number.isFinite(from.latitude) && Number.isFinite(from.longitude);
  const base = { warnings: [], geofence: null, snapDistanceMeters: 0, exit: null };

  if (hasCoordinates) {
    const source = from.source === "map" ? "map" : "device";
    const geofence = classifyPoint(campus.geofence, from, { latitude: campus.latitude, longitude: campus.longitude });

    if (geofence.status === "outside") {
      // Never pretend the user is on campus, and never draw a fake route from far away.
      return {
        early: {
          status: "away_from_campus",
          message:
            source === "map"
              ? "That point is outside this campus. Choose a starting point on campus to get walking directions."
              : "You're currently away from campus. Choose a starting point on campus to get walking directions.",
          geofence,
          route: null,
        },
      };
    }
    if (geofence.status === "unknown") {
      base.warnings.push("This campus has no boundary configured, so it cannot be confirmed that you are on campus.");
    } else if (geofence.ambiguous) {
      base.warnings.push("Your GPS accuracy is too low to be sure which side of the campus boundary you are on.");
    }

    const nearest = nearestNode(graph.nodes, from.latitude, from.longitude);
    const maxSnap = settingsOf(campus).maxSnapMeters || 150;
    if (!nearest.node || nearest.distanceMeters > maxSnap) {
      return {
        early: {
          status: "start_too_far_from_paths",
          message: "No walking path was found near your position. Choose a starting point from the list.",
          nearestPathDistanceMeters: nearest.node ? Math.round(nearest.distanceMeters) : null,
          maxSnapMeters: maxSnap,
          geofence,
          route: null,
        },
      };
    }
    return {
      ...base,
      geofence,
      mode: "coordinates",
      kind: source,
      startNode: nearest.node,
      snapDistanceMeters: nearest.distanceMeters,
      position: { latitude: from.latitude, longitude: from.longitude },
    };
  }

  if (from && from.nodeId) {
    const node = graph.nodesById.get(String(from.nodeId));
    if (!node) throw new ApiError(404, "Start node not found on this campus", undefined, "ORIGIN_NOT_FOUND");
    return { ...base, mode: "node", kind: "node", startNode: node };
  }

  if (from && from.landmarkId) {
    const landmark = await Landmark.findOne({ _id: from.landmarkId, campusId: campus._id }).lean();
    if (!landmark) throw new ApiError(404, "Start landmark not found on this campus", undefined, "ORIGIN_NOT_FOUND");
    if (!landmark.navigationNodeId) {
      throw new ApiError(422, `Landmark '${landmark.name}' is not connected to the walking network yet`, undefined, "LANDMARK_NOT_ROUTABLE");
    }
    const node = graph.nodesById.get(String(landmark.navigationNodeId));
    if (!node) throw new ApiError(404, "Start landmark's navigation node was not found", undefined, "ORIGIN_NOT_FOUND");
    return { ...base, mode: "landmark", kind: "landmark", startNode: node, label: landmark.name };
  }

  if (from && from.entranceId) {
    const entrance = await Entrance.findOne({ _id: from.entranceId, campusId: campus._id }).lean();
    if (!entrance) throw new ApiError(404, "Start entrance not found on this campus", undefined, "ORIGIN_NOT_FOUND");
    if (!entrance.navigationNodeId) {
      throw new ApiError(422, `Entrance '${entrance.name}' is not connected to the walking network yet`, undefined, "ENTRANCE_NOT_ROUTABLE");
    }
    const node = graph.nodesById.get(String(entrance.navigationNodeId));
    if (!node) throw new ApiError(404, "Start entrance's navigation node was not found", undefined, "ORIGIN_NOT_FOUND");
    const building = await Building.findById(entrance.buildingId).select("name").lean();
    return {
      ...base,
      mode: "entrance",
      kind: "entrance",
      startNode: node,
      label: entrance.name,
      exit: building ? { buildingName: building.name, entranceName: entrance.name } : null,
    };
  }

  throw new ApiError(400, "from must be { latitude, longitude }, { nodeId }, { landmarkId } or { entranceId }", undefined, "INVALID_REQUEST");
}

// ---------------------------------------------------------------------------------------------------------
// Path + response assembly
// ---------------------------------------------------------------------------------------------------------

function findBestPath(graph, startNodeId, endpoints) {
  let best = null;
  for (const endpoint of endpoints) {
    if (!graph.nodesById.has(endpoint.nodeId)) continue;
    const result = dijkstra(graph.graph, startNodeId, endpoint.nodeId);
    if (result && (!best || result.distance < best.result.distance)) best = { result, endpoint };
  }
  return best;
}

/** Nodes in walking order, annotated with what the instruction generator needs (edge type, landmark, floor...). */
async function annotateNodes({ campusId, graph, path, destination }) {
  const nodes = path.map((id) => graph.nodesById.get(id));

  const [landmarks, floors] = await Promise.all([
    Landmark.find({ campusId, isActive: true, navigationNodeId: { $in: nodes.map((n) => n._id) } }).select("name navigationNodeId").lean(),
    (() => {
      const floorIds = [...new Set(nodes.filter((n) => n.floorId).map((n) => String(n.floorId)))];
      return floorIds.length ? Floor.find({ _id: { $in: floorIds } }).lean() : [];
    })(),
  ]);
  const landmarkByNode = new Map(landmarks.map((l) => [String(l.navigationNodeId), l.name]));
  const floorById = new Map(floors.map((f) => [String(f._id), f]));

  return nodes.map((node, i) => {
    const next = path[i + 1];
    const edge = next ? graph.edgeByPair.get(pairKey(path[i], next)) : null;
    const entrance = destination.entranceNodes ? destination.entranceNodes.get(String(node._id)) : null;
    return {
      ...publicNode(node),
      landmark: landmarkByNode.get(String(node._id)) || undefined,
      edgeType: edge ? edge.type || "path" : undefined,
      distanceToNext: edge ? edge.distance : undefined,
      floorLabel: node.floorId ? floorLabel(floorById.get(String(node.floorId))) || undefined : undefined,
      enters: entrance && destination.building ? { buildingName: destination.building.name, entranceName: entrance.name } : undefined,
    };
  });
}

/**
 * Plans a route.
 * @param from { latitude, longitude, accuracyMeters?, source?: "device"|"map" } | { nodeId } | { landmarkId } | { entranceId }
 * @param to   { roomId } | { buildingId } | { entranceId } | { landmarkId }
 * @param options { accessibleOnly?: boolean }
 */
async function planRoute({ campusId, from, to, options = {} }) {
  const campus = await Campus.findById(campusId).lean();
  if (!campus) throw new ApiError(404, "Campus not found", undefined, "CAMPUS_NOT_FOUND");

  const destination = await resolveDestination(campusId, to);
  const accessibleOnly = Boolean(options && options.accessibleOnly);
  const graph = await getRoutingGraph(campusId, { accessibleOnly });

  const origin = await resolveOrigin({ campus, from, graph });
  if (origin.early) return origin.early;

  const settings = settingsOf(campus);
  const speed = validSpeed(settings.walkingSpeedMetersPerSecond || DEFAULT_WALKING_SPEED_MPS);

  // A room with an indoor node must exist in this campus's graph — never trust a dangling reference.
  if (destination.indoor && !graph.nodesById.has(destination.endpoints[0].nodeId)) {
    throw new ApiError(422, `Room '${destination.name}' is linked to a navigation node that is not on this campus's walking network`, undefined, "ROOM_NODE_MISSING");
  }

  const best = findBestPath(graph, String(origin.startNode._id), destination.endpoints);
  if (!best) {
    if (destination.indoor) {
      throw new ApiError(
        422,
        `No indoor path connects the outdoor network to ${destination.name}. Stairs, ramps or elevators between floors may not be mapped yet.`,
        undefined,
        "INDOOR_UNREACHABLE"
      );
    }
    throw new ApiError(422, "No walking route exists from the starting point to this destination", undefined, "NO_ROUTE");
  }

  const snapDistance = origin.snapDistanceMeters || 0;
  const entrance = best.endpoint.entrance || null;
  const indoorRouted = Boolean(best.endpoint.indoor);
  const walkNodes = await annotateNodes({ campusId, graph, path: best.result.path, destination });
  const endNode = walkNodes[walkNodes.length - 1];

  const steps = generateInstructions({
    nodes: walkNodes,
    start: { mode: origin.mode, snapDistanceMeters: snapDistance, position: origin.position, exit: origin.exit || undefined },
    destination: {
      kind: destination.kind,
      name: destination.name,
      buildingName: destination.building ? destination.building.name : undefined,
      entranceName: !indoorRouted && entrance ? entrance.name : undefined,
      roomName: destination.room ? destination.room.name : undefined,
      floor: destination.floor || undefined,
      indoorRouted,
    },
    options: {
      speedMetersPerSecond: speed,
      startOffsetMeters: snapDistance,
      indexOffset: origin.mode === "coordinates" ? 1 : 0,
    },
  });

  const geometryCoordinates = walkNodes.map((n) => [n.longitude, n.latitude]);
  if (origin.mode === "coordinates") geometryCoordinates.unshift([origin.position.longitude, origin.position.latitude]);

  const distanceMeters = Math.round(best.result.distance + snapDistance);
  const destinationPosition = entrance
    ? { latitude: entrance.latitude, longitude: entrance.longitude }
    : destination.position || { latitude: endNode.latitude, longitude: endNode.longitude };

  const roomFloor = destination.floor ? { id: String(destination.floor._id), floorNumber: destination.floor.floorNumber, name: destination.floor.name } : null;

  return {
    status: "ok",
    campus: { id: String(campus._id), name: campus.name },
    origin: {
      kind: origin.kind,
      latitude: origin.position ? origin.position.latitude : walkNodes[0].latitude,
      longitude: origin.position ? origin.position.longitude : walkNodes[0].longitude,
      name: origin.label || (origin.mode === "node" || origin.mode === "landmark" ? walkNodes[0].name || undefined : undefined),
      nodeId: String(origin.startNode._id),
      snapDistanceMeters: Math.round(snapDistance),
    },
    distanceMeters,
    graphDistanceMeters: Math.round(best.result.distance),
    durationSeconds: walkingSeconds(distanceMeters, speed),
    geometry: { type: "LineString", coordinates: geometryCoordinates }, // [lng, lat], follows graph edges only
    steps,
    // Older clients: flat list of the same steps.
    instructions: steps.map(({ type, text, distanceMeters: d, nodeId }) => ({ type, text, distanceMeters: d, nodeId })),
    start: { mode: origin.mode, nodeId: String(origin.startNode._id), snapDistanceMeters: Math.round(snapDistance) },
    geofence: origin.geofence,
    warnings: origin.warnings,
    destination: {
      kind: destination.kind,
      name: destination.name,
      room: destination.room ? { id: String(destination.room._id), name: destination.room.name } : null,
      floor: roomFloor,
      building: destination.building ? { id: String(destination.building._id), name: destination.building.name } : null,
      entrance: entrance ? { id: String(entrance._id), name: entrance.name, latitude: entrance.latitude, longitude: entrance.longitude } : null,
      position: destinationPosition,
      // Where the walking route ends vs. where the room is. No indoor corridors are invented.
      indoor: destination.room
        ? {
            routed: indoorRouted,
            floor: roomFloor,
            description: roomFloor ? `${destination.room.name} is on the ${floorLabel(destination.floor)}.` : null,
          }
        : null,
      dataSource: (destination.room || destination.building || destination.landmark).dataSource,
    },
    nodeIds: best.result.path,
    path: [
      ...(origin.mode === "coordinates" ? [{ id: null, name: "Your position", type: "user", latitude: origin.position.latitude, longitude: origin.position.longitude }] : []),
      ...walkNodes.map(publicNode),
    ],
    metadata: {
      walkingSpeedMetersPerSecond: speed,
      rerouteDeviationMeters: settings.rerouteDeviationMeters || 30,
      rerouteMinIntervalSeconds: settings.rerouteMinIntervalSeconds || 15,
      arrivalRadiusMeters: settings.arrivalRadiusMeters || 15,
      graphVersion: graph.version,
      accessibleOnly,
      edgesIgnored: graph.ignored,
      indoorRouting: indoorRouted ? "routed" : "not_available",
    },
  };
}

module.exports = { planRoute, nearestNode, resolveDestination };
