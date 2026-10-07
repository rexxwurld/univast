const { canonicalKey } = require("./campusText");

/** Categories from the product spec. Stored on Building.type / Landmark.type / Room.type. */
const CAMPUS_CATEGORIES = [
  "faculty",
  "lecture_hall",
  "library",
  "hostel",
  "administration",
  "health",
  "food",
  "atm",
  "gate",
  "landmark",
  "other",
];

const ROOM_TYPES = ["lecture_hall", "classroom", "laboratory", "office", "library", "other"];

// Words a student might type that mean a whole category ("hostels", "clinic").
// Add synonyms here; they are canonicalized exactly like names, so spelling
// variants are handled by campusText rules.
const CATEGORY_SYNONYMS = {
  faculty: ["faculty", "faculties", "school", "schools", "college", "colleges"],
  lecture_hall: [
    "lecture hall", "lecture halls", "lecture theatre", "lecture theatres",
    "lecture theater", "lecture theaters", "lecture", "lectures", "lts", "lhs",
  ],
  library: ["library", "libraries"],
  hostel: ["hostel", "hostels", "accommodation", "residence", "residences", "dormitory", "dormitories", "dorm", "dorms"],
  administration: ["admin", "administration", "administrative", "offices"],
  health: ["health", "health centre", "health center", "clinic", "hospital", "medical", "sickbay"],
  food: ["food", "cafeteria", "canteen", "restaurant", "restaurants", "eat"],
  atm: ["atm", "atms", "cash machine"],
  gate: ["gate", "gates"],
  landmark: ["landmark", "landmarks"],
};

const SYNONYM_TO_CATEGORY = new Map();
for (const [category, words] of Object.entries(CATEGORY_SYNONYMS)) {
  for (const word of words) SYNONYM_TO_CATEGORY.set(canonicalKey(word), category);
}

/** Returns the category a whole query refers to, or null ("LT1" is not a category). */
function resolveCategory(query) {
  const key = canonicalKey(query);
  return key ? SYNONYM_TO_CATEGORY.get(key) || null : null;
}

module.exports = { CAMPUS_CATEGORIES, ROOM_TYPES, CATEGORY_SYNONYMS, resolveCategory };
