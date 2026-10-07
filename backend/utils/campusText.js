/**
 * Campus-name normalization — the single place that decides when two strings
 * "mean the same campus place". Pure (no dependencies) so it is unit-testable
 * and can run identically when building stored search keys and when resolving
 * a query.
 *
 *   "LT1" / "lt1" / "LT 1" / "L.T. 1" / "Lecture Theatre 1" / "Lecture Theater 1"
 *     -> "lt1"
 *
 * Extension point: add rules to ABBREVIATION_RULES for new naming patterns.
 * Stored keys (the `searchKeys` field) must then be rebuilt with
 * scripts/reindexSearchKeys.js — a rule change alters every key.
 */

// Words that carry no identity. Dropped from keys ("the Main Library" == "Main Library").
// NOTE: single letters are deliberately NOT stop words ("Hostel A" must stay distinct).
const STOP_WORDS = new Set(["the", "of", "and", "at", "in", "for"]);

// Applied in order, to already-normalized (lowercase, space-separated) text.
const ABBREVIATION_RULES = [
  [/\btheater(s?)\b/g, "theatre$1"],
  [/\bcenter(s?)\b/g, "centre$1"],
  [/\blecture theatre\b/g, "lt"],
  [/\blecture hall\b/g, "lh"],
  [/\broom\b/g, "rm"],
  [/\blaboratory\b/g, "lab"],
  [/\badministrative\b/g, "admin"],
  [/\badministration\b/g, "admin"],
  [/\bdepartment\b/g, "dept"],
];

/** Lowercase, strip accents, "&" -> "and", punctuation -> space, collapse whitespace. */
function normalizeText(input) {
  if (input === undefined || input === null) return "";
  let text = String(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "");

  // "L.T. 1" -> "lt 1" (dotted initials) before punctuation becomes whitespace.
  for (let i = 0; i < 3; i += 1) {
    text = text.replace(/\b([a-z])\.\s?(?=[a-z]\b)/g, "$1");
  }
  text = text.replace(/\b([a-z])\.(?=\s|$)/g, "$1");

  return text.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/**
 * The comparison key for a name/alias/query. Two strings are "the same place name"
 * when their canonical keys are equal.
 */
function canonicalKey(input) {
  let text = normalizeText(input);
  if (!text) return "";

  for (const [pattern, replacement] of ABBREVIATION_RULES) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token))
    .join(" ");

  // Join a short letter prefix with its number: "lt 1" -> "lt1", "rm 104" -> "rm104".
  text = text.replace(/\b([a-z]{1,3}) (\d+[a-z]?)\b/g, "$1$2");

  return text;
}

function tokenize(key) {
  return key ? key.split(" ").filter(Boolean) : [];
}

/** Unique, non-empty canonical keys for a list of raw strings. */
function buildKeys(values) {
  const keys = new Set();
  for (const value of values) {
    const key = canonicalKey(value);
    if (key) keys.add(key);
  }
  return [...keys];
}

module.exports = { normalizeText, canonicalKey, tokenize, buildKeys, STOP_WORDS, ABBREVIATION_RULES };
