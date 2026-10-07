/**
 * Pure graph utilities for the navigation routing engine — zero dependencies,
 * so this can be unit tested in isolation from Mongoose/Express and from the
 * DB-loading code in services/routingService.js.
 */

/**
 * Builds an adjacency-list graph from nodes and edges.
 * graph[nodeId] = [{ to: nodeId, distance }, ...]
 */
function buildGraph(nodes, edges) {
  const graph = new Map();

  for (const node of nodes) {
    graph.set(String(node._id ?? node.id), []);
  }

  for (const edge of edges) {
    const from = String(edge.from);
    const to = String(edge.to);

    if (!graph.has(from) || !graph.has(to)) {
      // Edge references a node outside the loaded set — skip rather than crash.
      continue;
    }

    graph.get(from).push({ to, distance: edge.distance });

    if (edge.bidirectional) {
      graph.get(to).push({ to: from, distance: edge.distance });
    }
  }

  return graph;
}

/**
 * Classic Dijkstra shortest path over an adjacency-list graph (see buildGraph).
 * Returns { distance, path } where path is an ordered array of node id strings,
 * or null if no route exists between startId and endId.
 */
function dijkstra(graph, startId, endId) {
  startId = String(startId);
  endId = String(endId);

  if (!graph.has(startId) || !graph.has(endId)) {
    return null;
  }

  const distances = new Map();
  const previous = new Map();
  const visited = new Set();

  for (const nodeId of graph.keys()) {
    distances.set(nodeId, Infinity);
  }
  distances.set(startId, 0);

  // Simple array-backed priority queue. Fine for campus-scale graphs
  // (hundreds to low thousands of nodes); swap for a binary heap if this
  // ever needs to scale to a much larger graph.
  const queue = [startId];

  while (queue.length > 0) {
    queue.sort((a, b) => distances.get(a) - distances.get(b));
    const current = queue.shift();

    if (visited.has(current)) continue;
    visited.add(current);

    if (current === endId) break;

    const neighbors = graph.get(current) || [];
    for (const { to, distance } of neighbors) {
      if (visited.has(to)) continue;

      const candidate = distances.get(current) + distance;
      if (candidate < distances.get(to)) {
        distances.set(to, candidate);
        previous.set(to, current);
        queue.push(to);
      }
    }
  }

  if (distances.get(endId) === Infinity) {
    return null;
  }

  const path = [endId];
  let cursor = endId;
  while (cursor !== startId) {
    cursor = previous.get(cursor);
    if (cursor === undefined) return null; // Shouldn't happen, but stay defensive.
    path.unshift(cursor);
  }

  return { distance: distances.get(endId), path };
}

module.exports = { buildGraph, dijkstra };
