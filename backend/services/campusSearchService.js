const Building = require("../models/Building");
const Room = require("../models/Room");
const Landmark = require("../models/Landmark");
const Location = require("../models/Location");
const Floor = require("../models/Floor");
const { rankCandidates } = require("../utils/search");
const { resolveCategory } = require("../utils/campusCategories");
const { canonicalKey } = require("../utils/campusText");

/**
 * Campus-aware search: name / alias / abbreviation / room number / category.
 * Candidates for ONE campus are loaded (campus-scale: hundreds to a few thousand)
 * and ranked by utils/search.js. Does not depend on MongoDB text indexes.
 */
async function loadCandidates(campusId) {
  const [buildings, rooms, floors, landmarks, locations] = await Promise.all([
    Building.find({ campusId, isActive: true }).lean(),
    Room.find({ campusId, isActive: true }).lean(),
    Floor.find({ campusId }).lean(),
    Landmark.find({ campusId, isActive: true }).lean(),
    Location.find({ campusId }).lean(), // legacy campus Locations stay searchable
  ]);

  const buildingsById = new Map(buildings.map((b) => [String(b._id), b]));
  const floorsById = new Map(floors.map((f) => [String(f._id), f]));

  const candidates = [];

  for (const b of buildings) {
    candidates.push({ kind: "building", id: String(b._id), name: b.name, category: b.type, keys: b.searchKeys || [], doc: b });
  }
  for (const r of rooms) {
    const building = buildingsById.get(String(r.buildingId));
    candidates.push({
      kind: "room",
      id: String(r._id),
      name: r.name,
      category: r.type,
      keys: r.searchKeys || [],
      contextKeys: building ? building.searchKeys || [] : [],
      doc: r,
      building,
      floor: floorsById.get(String(r.floorId)),
    });
  }
  for (const l of landmarks) {
    candidates.push({ kind: "landmark", id: String(l._id), name: l.name, category: l.type, keys: l.searchKeys || [], doc: l });
  }
  for (const l of locations) {
    candidates.push({ kind: "location", id: String(l._id), name: l.name, category: l.category, keys: l.searchKeys || [], doc: l });
  }
  return candidates;
}

function toResult(candidate, score, matchedOn) {
  const { doc, building, floor } = candidate;
  const result = {
    kind: candidate.kind,
    id: candidate.id,
    name: candidate.name,
    category: candidate.category,
    description: doc.description || "",
    score,
    matchedOn,
    dataSource: doc.dataSource,
  };
  if (candidate.kind === "room") {
    result.building = building ? { id: String(building._id), name: building.name } : null;
    result.floor = floor ? { id: String(floor._id), floorNumber: floor.floorNumber, name: floor.name } : null;
    result.latitude = building ? building.latitude : null; // rooms render at their building until indoor mapping exists
    result.longitude = building ? building.longitude : null;
  } else {
    result.latitude = doc.latitude;
    result.longitude = doc.longitude;
  }
  return result;
}

/**
 * @returns { query, results:[...], ambiguous:boolean, category:string|null }
 * `ambiguous` = the top results tie on score but are different places (e.g. "LT1" in two buildings);
 * the client should ask the user to choose rather than silently pick one.
 */
async function searchCampus({ campusId, query, limit = 20 }) {
  const trimmed = String(query || "").trim();
  if (!canonicalKey(trimmed)) return { query: trimmed, results: [], ambiguous: false, category: null };

  const candidates = await loadCandidates(campusId);
  const category = resolveCategory(trimmed);

  let ranked = rankCandidates(trimmed, candidates, { limit });
  const results = ranked.map((r) => toResult(r.candidate, r.score, r.matchedOn));

  if (category) {
    const seen = new Set(results.map((r) => `${r.kind}:${r.id}`));
    for (const c of candidates) {
      if (c.category === category && !seen.has(`${c.kind}:${c.id}`)) {
        results.push(toResult(c, 50, `category:${category}`));
      }
    }
    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  const trimmedResults = results.slice(0, limit);
  const top = trimmedResults[0];
  const ambiguous = Boolean(top && top.score >= 100 && trimmedResults.filter((r) => r.score === top.score).length > 1);

  return { query: trimmed, results: trimmedResults, ambiguous, category };
}

module.exports = { searchCampus, loadCandidates };
