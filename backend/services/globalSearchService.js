const University = require("../models/University");
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const Room = require("../models/Room");
const Landmark = require("../models/Landmark");
const Place = require("../models/Place");
const Category = require("../models/Category");
const Alias = require("../models/Alias");
const { rankCandidates } = require("../utils/search");
const { canonicalKey } = require("../utils/campusText");
const ApiError = require("../utils/ApiError");
const { forwardGeocode } = require("../utils/geocode");
const { getOrLoad } = require("./globalSearchCache");
const { mergeGeoResults } = require("../utils/searchMerge");

const canonicalKeys = (values) => values.filter(Boolean).map(canonicalKey).filter(Boolean);

async function loadAliasMap(targetModel, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const docs = await Alias.find({
    targetModel,
    targetId: { $in: ids },
    isActive: true,
  }).lean();

  const map = new Map();
  for (const alias of docs) {
    const key = String(alias.targetId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(alias.value);
  }
  return map;
}

/**
 * Load all searchable candidates across all campuses.
 * @returns { kind, id, name, category, keys[], campusId, universityId?, ... }
 */
async function loadGlobalCandidates() {
  return getOrLoad(buildGlobalCandidates);
}

async function buildGlobalCandidates() {
  const [universities, campuses, buildings, rooms, landmarks, places, categories] = await Promise.all([
    University.find({}).lean(),
    Campus.find({}).lean(),
    Building.find({ isActive: true }).lean(),
    Room.find({ isActive: true }).lean(),
    Landmark.find({ isActive: true }).lean(),
    Place.find({ isActive: true }).lean(),
    Category.find({ isActive: true }).lean(),
  ]);

  const campusesById = new Map(campuses.map((c) => [String(c._id), c]));
  const universitiesById = new Map(universities.map((u) => [String(u._id), u]));
  const buildingsById = new Map(buildings.map((b) => [String(b._id), b]));
  const categoryById = new Map(categories.map((category) => [String(category._id), category]));

  const buildingAliasMap = await loadAliasMap("Building", buildings.map((b) => b._id));
  const roomAliasMap = await loadAliasMap("Room", rooms.map((r) => r._id));
  const campusAliasMap = await loadAliasMap("Campus", campuses.map((c) => c._id));
  const landmarkAliasMap = await loadAliasMap("Landmark", landmarks.map((l) => l._id));
  const universityAliasMap = await loadAliasMap("University", universities.map((u) => u._id));
  const placeAliasMap = await loadAliasMap("Place", places.map((place) => place._id));

  const candidates = [];

  // Universities: name + abbreviation as searchKeys
  for (const u of universities) {
    const aliases = universityAliasMap.get(String(u._id)) || [];
    candidates.push({
      kind: "university",
      id: String(u._id),
      name: u.name,
      abbreviation: u.abbreviation || u.ShortName,
      city: u.city || "",
      state: u.state || "",
      country: u.country || "",
      keys: canonicalKeys([
        ...(u.name ? [u.name] : []),
        ...(u.abbreviation ? [u.abbreviation] : []),
        ...(u.ShortName && u.ShortName !== u.abbreviation ? [u.ShortName] : []),
        ...aliases,
      ]),
      category: "university",
      doc: u,
    });
  }

  // Campuses: name + abbreviation
  for (const c of campuses) {
    const university = universitiesById.get(String(c.universityId));
    const aliases = campusAliasMap.get(String(c._id)) || [];
    candidates.push({
      kind: "campus",
      id: String(c._id),
      name: c.name,
      universityId: String(c.universityId),
      universityName: university ? university.name : null,
        keys: canonicalKeys([c.name, university?.name, university?.abbreviation, ...aliases]),
      category: "campus",
      doc: c,
    });
  }

  // Buildings: name + aliases
  for (const b of buildings) {
    const campus = campusesById.get(String(b.campusId));
    const university = campus ? universitiesById.get(String(campus.universityId)) : null;
    const aliases = buildingAliasMap.get(String(b._id)) || [];
    candidates.push({
      kind: "building",
      id: String(b._id),
      name: b.name,
      campusId: String(b.campusId),
      campusName: campus ? campus.name : null,
      universityId: campus ? String(campus.universityId) : null,
      universityName: university ? university.name : null,
      keys: canonicalKeys([...(b.searchKeys || []), ...aliases]),
      category: b.type,
      doc: b,
    });
  }

  // Rooms: name + room number + aliases
  for (const r of rooms) {
    const building = buildingsById.get(String(r.buildingId));
    const campus = building ? campusesById.get(String(building.campusId)) : null;
    const university = campus ? universitiesById.get(String(campus.universityId)) : null;
    const aliases = roomAliasMap.get(String(r._id)) || [];
    candidates.push({
      kind: "room",
      id: String(r._id),
      name: r.name,
      roomNumber: r.roomNumber,
      buildingId: String(r.buildingId),
      buildingName: building ? building.name : null,
      campusId: String(r.campusId),
      campusName: campus ? campus.name : null,
      universityId: campus ? String(campus.universityId) : null,
      universityName: university ? university.name : null,
      latitude: building ? building.latitude : null,
      longitude: building ? building.longitude : null,
      keys: canonicalKeys([...(r.searchKeys || []), ...aliases]),
      contextKeys: building ? (building.searchKeys || []) : [],
      category: r.type,
      doc: r,
    });
  }

  // Landmarks: name + aliases
  for (const l of landmarks) {
    const campus = campusesById.get(String(l.campusId));
    const university = campus ? universitiesById.get(String(campus.universityId)) : null;
    const aliases = landmarkAliasMap.get(String(l._id)) || [];
    candidates.push({
      kind: "landmark",
      id: String(l._id),
      name: l.name,
      campusId: String(l.campusId),
      campusName: campus ? campus.name : null,
      universityId: campus ? String(campus.universityId) : null,
      universityName: university ? university.name : null,
      keys: canonicalKeys([...(l.searchKeys || []), ...aliases]),
      category: l.type,
      doc: l,
    });
  }

  // Places (discovery platform): aliases and category metadata are part of the
  // global result so the mobile client can render a place without a campus selection.
  for (const p of places) {
    const category = categoryById.get(String(p.category));
    const aliases = placeAliasMap.get(String(p._id)) || [];
    candidates.push({
      kind: "place",
      id: String(p._id),
      name: p.name,
      category: category?.name || p.category || "place",
      categoryId: String(p.category),
      aliases,
      sourceCampusId: p.sourceCampusId ? String(p.sourceCampusId) : null,
      description: p.description || "",
      address: p.address || "",
      keys: canonicalKeys([p.name, ...aliases]),
      doc: p,
    });
  }

  return candidates;
}

function toResult(candidate, score, matchedOn) {
  const result = {
    kind: candidate.kind,
    id: candidate.id,
    name: candidate.name,
    category: candidate.category,
    score,
    matchedOn,
  };

  if (candidate.kind === "university") {
    result.abbreviation = candidate.abbreviation;
    result.city = candidate.city;
    result.state = candidate.state;
    result.country = candidate.country;
  } else if (candidate.kind === "campus") {
    result.campusId = candidate.id;
    result.universityId = candidate.universityId;
    result.universityName = candidate.universityName;
    result.latitude = candidate.doc.latitude;
    result.longitude = candidate.doc.longitude;
  } else if (candidate.kind === "building") {
    result.campusId = candidate.campusId;
    result.campusName = candidate.campusName;
    result.universityId = candidate.universityId;
    result.universityName = candidate.universityName;
    result.latitude = candidate.doc.latitude;
    result.longitude = candidate.doc.longitude;
  } else if (candidate.kind === "room") {
    result.buildingId = candidate.buildingId;
    result.buildingName = candidate.buildingName;
    result.campusId = candidate.campusId;
    result.campusName = candidate.campusName;
    result.universityId = candidate.universityId;
    result.universityName = candidate.universityName;
    result.roomNumber = candidate.roomNumber;
    result.latitude = candidate.doc.latitude ?? candidate.latitude;
    result.longitude = candidate.doc.longitude ?? candidate.longitude;
  } else if (candidate.kind === "landmark") {
    result.campusId = candidate.campusId;
    result.campusName = candidate.campusName;
    result.universityId = candidate.universityId;
    result.universityName = candidate.universityName;
    result.latitude = candidate.doc.latitude;
    result.longitude = candidate.doc.longitude;
  } else if (candidate.kind === "place") {
    result.category = candidate.category;
    result.categoryId = candidate.categoryId;
    result.aliases = candidate.aliases;
    result.description = candidate.description;
    result.address = candidate.address;
    result.sourceCampusId = candidate.sourceCampusId;
    result.latitude = candidate.doc.location ? candidate.doc.location.coordinates[1] : null;
    result.longitude = candidate.doc.location ? candidate.doc.location.coordinates[0] : null;
  }

  result.dataSource = candidate.doc.dataSource;
  return result;
}

/**
 * One search for the whole app: UNIVAST's own data (universities, campuses, buildings, rooms, landmarks,
 * places, with aliases/student terminology) ranked first, then — only when `includeGeo` is set — general map
 * places from a geocoder (cities, streets, businesses anywhere).
 *
 * @param query search string
 * @param limit max UNIVAST results (default 20, max 50); geocoder hits are extra (at most 5)
 * @param includeGeo ask the geocoder too. Callers must do this only for an explicit/submitted search
 *        (geocoder usage policies forbid search-as-you-type).
 * @param near optional { latitude, longitude } used only to bias geocoder results
 * @param geocoder injectable for tests
 * @returns { query, results:[...], ambiguous:boolean, geo:{ requested, status } }
 *          geo.status: "skipped" (not asked) | "ok" | "disabled" | "unavailable" — so clients can say honestly
 *          when general-map results are missing instead of implying there are none.
 */
async function searchGlobal({ query, limit = 20, includeGeo = false, near = null, geocoder = forwardGeocode }) {
  const trimmed = String(query || "").trim();
  const normalized = canonicalKey(trimmed);
  const geo = { requested: Boolean(includeGeo), status: "skipped" };
  if (!normalized) return { query: normalized, results: [], ambiguous: false, geo };
  if (trimmed.length > 100) throw new ApiError(400, "Query too long (max 100 characters)");

  const maxLimit = Math.min(Math.max(limit, 1), 50);

  // The UNIVAST lookup and the (slower, external) geocoder lookup run in parallel; a geocoder failure can
  // never fail or delay-fail the UNIVAST results.
  const geoPromise = includeGeo ? lookupGeo(geocoder, trimmed, near, geo) : Promise.resolve([]);
  const candidates = await loadGlobalCandidates();

  const ranked = rankCandidates(normalized, candidates, { limit: maxLimit });
  const univastResults = ranked.map((r) => toResult(r.candidate, r.score, r.matchedOn)).slice(0, maxLimit);
  const top = univastResults[0];
  const ambiguous = Boolean(top && top.score >= 100 && univastResults.filter((r) => r.score === top.score).length > 1);

  const geoRows = await geoPromise;
  const results = geoRows.length > 0 ? mergeGeoResults(univastResults, geoRows) : univastResults;
  return { query: normalized, results, ambiguous, geo };
}

async function lookupGeo(geocoder, query, near, geo) {
  if (process.env.GEOCODER_SEARCH_ENABLED === "false") {
    geo.status = "disabled";
    return [];
  }
  try {
    const rows = await geocoder(query, { limit: 5, near });
    geo.status = "ok";
    return rows;
  } catch (err) {
    geo.status = "unavailable";
    return [];
  }
}

module.exports = { searchGlobal, loadGlobalCandidates };
