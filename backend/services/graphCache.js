/**
 * Per-campus routing-graph cache. Loading every node and edge for each request is wasteful when the
 * graph almost never changes, so the loaded data AND the prebuilt adjacency graphs are kept in memory.
 *
 * Staleness is bounded three ways:
 *  1. writes through Mongoose invalidate it immediately (models/plugins/graphCacheInvalidation.js);
 *  2. a TTL (ROUTING_GRAPH_CACHE_SECONDS, default 60; 0 disables caching) covers writes made elsewhere;
 *  3. every route response carries `metadata.graphVersion`, a hash of the graph's content, so clients can tell
 *     when the graph changed under them (and a later offline-pack phase can compare it with a pack's version).
 *
 * Only NODES and EDGES are cached. Destinations (rooms, entrances, landmarks) and campus settings are read
 * fresh on every request so editor changes there apply immediately.
 */
const crypto = require("crypto");
const NavigationNode = require("../models/NavigationNode");
const NavigationEdge = require("../models/NavigationEdge");
const ApiError = require("../utils/ApiError");
const { buildGraph } = require("../utils/graph");
const { VERTICAL_CONNECTOR_TYPES, NEVER_ACCESSIBLE_TYPES } = require("../utils/routingConstants");

const entries = new Map(); // campusId -> { at, promise }

const ttlMs = () => {
  const raw = process.env.ROUTING_GRAPH_CACHE_SECONDS;
  const seconds = raw === undefined || raw === "" ? 60 : Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

const pairKey = (a, b) => `${a}|${b}`;
const latest = (docs) => docs.reduce((max, d) => (d.updatedAt && +d.updatedAt > max ? +d.updatedAt : max), 0);

function versionOf(nodes, edges) {
  return crypto.createHash("sha1").update(`${nodes.length}:${edges.length}:${latest(nodes)}:${latest(edges)}`).digest("hex").slice(0, 12);
}

/**
 * Splits edges into usable and ignored for a routing profile.
 *  - restricted edges are never used;
 *  - accessibleOnly additionally drops stairs and edges explicitly marked not accessible;
 *  - an edge joining two DIFFERENT floors must be a vertical connector (stairs/ramp/elevator), otherwise the data is
 *    invalid and the edge is ignored — a route may never "teleport" between floors.
 */
function filterEdges(edges, nodesById, { accessibleOnly }) {
  const usable = [];
  const ignored = { restricted: 0, inaccessible: 0, invalidFloorTransition: 0 };

  for (const edge of edges) {
    if (edge.isRestricted) { ignored.restricted += 1; continue; }
    if (accessibleOnly && (NEVER_ACCESSIBLE_TYPES.has(edge.type) || edge.isAccessible === false)) { ignored.inaccessible += 1; continue; }

    const a = nodesById.get(String(edge.from));
    const b = nodesById.get(String(edge.to));
    const fa = a && a.floorId ? String(a.floorId) : null;
    const fb = b && b.floorId ? String(b.floorId) : null;
    if (fa && fb && fa !== fb && !VERTICAL_CONNECTOR_TYPES.has(edge.type)) { ignored.invalidFloorTransition += 1; continue; }

    usable.push(edge);
  }
  return { usable, ignored };
}

function buildEntry(nodes, edges) {
  const nodesById = new Map(nodes.map((n) => [String(n._id), n]));
  const profiles = new Map();

  const profile = (accessibleOnly) => {
    const key = accessibleOnly ? "accessible" : "default";
    if (!profiles.has(key)) {
      const { usable, ignored } = filterEdges(edges, nodesById, { accessibleOnly });
      const edgeByPair = new Map();
      for (const e of usable) {
        // If two edges join the same pair, remember the shorter one (it is the one Dijkstra would use).
        for (const [a, b] of e.bidirectional ? [[String(e.from), String(e.to)], [String(e.to), String(e.from)]] : [[String(e.from), String(e.to)]]) {
          const existing = edgeByPair.get(pairKey(a, b));
          if (!existing || e.distance < existing.distance) edgeByPair.set(pairKey(a, b), e);
        }
      }
      profiles.set(key, { graph: buildGraph(nodes, usable), edgeByPair, ignored });
    }
    return profiles.get(key);
  };

  return { nodes, edges, nodesById, version: versionOf(nodes, edges), profile };
}

async function load(campusId) {
  const [nodes, edges] = await Promise.all([
    NavigationNode.find({ campusId }).lean(),
    NavigationEdge.find({ campusId }).lean(),
  ]);
  return buildEntry(nodes, edges);
}

/** Returns { nodes, nodesById, version, graph, edgeByPair, ignored } for the campus and profile. */
async function getRoutingGraph(campusId, { accessibleOnly = false } = {}) {
  const key = String(campusId);
  const ttl = ttlMs();
  let entry = entries.get(key);

  if (!entry || ttl === 0 || Date.now() - entry.at > ttl) {
    entry = { at: Date.now(), promise: load(campusId) };
    if (ttl > 0) entries.set(key, entry);
    entry.promise.catch(() => entries.delete(key)); // never keep a failed load
  }

  const data = await entry.promise;
  if (data.nodes.length === 0) throw new ApiError(404, "No navigation nodes found for this campus", undefined, "NO_NAVIGATION_GRAPH");
  const { graph, edgeByPair, ignored } = data.profile(accessibleOnly);
  return { nodes: data.nodes, nodesById: data.nodesById, version: data.version, graph, edgeByPair, ignored };
}

/** Drop one campus's cached graph, or every campus when no id is given. */
function invalidate(campusId) {
  if (campusId) entries.delete(String(campusId));
  else entries.clear();
}

module.exports = { getRoutingGraph, invalidate, filterEdges, pairKey };
