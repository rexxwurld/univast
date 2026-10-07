const NavigationNode = require("../models/NavigationNode");
const NavigationEdge = require("../models/NavigationEdge");
const ApiError = require("../utils/ApiError");
const { haversineDistance } = require("../utils/distance");
const { buildGraph, dijkstra } = require("../utils/graph");

/**
 * Loads nodes/edges for a campus, computes the shortest walking route between
 * two navigation nodes, and returns it in API-response shape.
 */
async function getShortestRoute({ campusId, startNodeId, endNodeId }) {
  const [nodes, edges] = await Promise.all([
    NavigationNode.find({ campusId }).lean(),
    NavigationEdge.find({ campusId }).lean(),
  ]);

  if (nodes.length === 0) {
    throw new ApiError(404, "No navigation nodes found for this campus");
  }

  const nodesById = new Map(nodes.map((n) => [String(n._id), n]));

  if (!nodesById.has(String(startNodeId))) {
    throw new ApiError(404, `startNodeId '${startNodeId}' was not found on this campus`);
  }
  if (!nodesById.has(String(endNodeId))) {
    throw new ApiError(404, `endNodeId '${endNodeId}' was not found on this campus`);
  }

  const graph = buildGraph(nodes, edges);
  const result = dijkstra(graph, startNodeId, endNodeId);

  if (!result) {
    throw new ApiError(404, "No walking route exists between the given nodes");
  }

  const orderedNodes = result.path.map((id) => nodesById.get(id));

  return {
    distance: result.distance,
    nodeIds: result.path,
    nodes: orderedNodes,
  };
}

/**
 * Finds the navigation node on a campus closest to a given coordinate,
 * using Haversine distance.
 */
async function findNearestNode({ campusId, latitude, longitude }) {
  const nodes = await NavigationNode.find({ campusId }).lean();

  if (nodes.length === 0) {
    throw new ApiError(404, "No navigation nodes found for this campus");
  }

  let nearest = null;
  let nearestDistance = Infinity;

  for (const node of nodes) {
    const distance = haversineDistance(latitude, longitude, node.latitude, node.longitude);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = node;
    }
  }

  return { node: nearest, distance: nearestDistance };
}

module.exports = { getShortestRoute, findNearestNode };
