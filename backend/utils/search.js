/**
 * Pure ranking for campus search. Candidates are plain objects:
 *   { kind, id, name, keys:[canonical keys], contextKeys?:[...], category?, ...extra }
 * `contextKeys` are keys of the parent (a room's building) so "science lt1" can
 * find LT1 inside the Science block.
 */
const { canonicalKey, tokenize } = require("./campusText");

// Tie-break only (equal score): specific campus entities, then institutions, then general places.
const KIND_PRIORITY = { room: 0, building: 1, landmark: 2, location: 3, university: 4, campus: 5, place: 6, geo: 7 };

function levenshtein(a, b, maxDistance) {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

const hasDigit = (s) => /\d/.test(s);

/** Score one query against one candidate key. 0 = no match. */
function scoreKey(queryKey, queryTokens, key) {
  if (!key) return 0;
  if (key === queryKey) return 100;

  const keyTokens = tokenize(key);

  if (queryKey.length >= 2 && key.startsWith(queryKey)) {
    return 75 + Math.round((10 * queryKey.length) / key.length);
  }
  if (queryTokens.every((t) => keyTokens.includes(t))) return 70;
  if (queryTokens.every((t) => keyTokens.some((k) => k.startsWith(t)))) return 65;
  if (queryKey.length >= 3 && key.includes(queryKey)) return 55;

  // Typo tolerance — never for anything containing digits: "lt1" vs "lt2" is a different room.
  if (!hasDigit(queryKey) && !hasDigit(key) && queryKey.length >= 4) {
    const maxEdits = queryKey.length >= 8 ? 2 : 1;
    if (levenshtein(queryKey, key, maxEdits) <= maxEdits) return 45;
  }
  return 0;
}

function scoreCandidate(queryKey, queryTokens, candidate) {
  let best = { score: 0, matchedOn: null };
  for (const key of candidate.keys || []) {
    const score = scoreKey(queryKey, queryTokens, key);
    if (score > best.score) best = { score, matchedOn: key };
  }

  // Parent context: every query token appears in (candidate key + parent key) and at
  // least one comes from the candidate itself.
  if (best.score < 62 && candidate.contextKeys && candidate.contextKeys.length && queryTokens.length > 1) {
    for (const key of candidate.keys || []) {
      const own = new Set(tokenize(key));
      for (const contextKey of candidate.contextKeys) {
        const all = new Set([...own, ...tokenize(contextKey)]);
        if (queryTokens.every((t) => all.has(t)) && queryTokens.some((t) => own.has(t))) {
          if (62 > best.score) best = { score: 62, matchedOn: `${contextKey} ${key}` };
        }
      }
    }
  }
  return best;
}

function rankCandidates(query, candidates, { limit = 20, minScore = 45 } = {}) {
  const queryKey = canonicalKey(query);
  if (!queryKey) return [];
  const queryTokens = tokenize(queryKey);

  const results = [];
  for (const candidate of candidates) {
    const { score, matchedOn } = scoreCandidate(queryKey, queryTokens, candidate);
    if (score >= minScore) results.push({ candidate, score, matchedOn });
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      (KIND_PRIORITY[a.candidate.kind] ?? 9) - (KIND_PRIORITY[b.candidate.kind] ?? 9) ||
      String(a.candidate.name).localeCompare(String(b.candidate.name))
  );
  return results.slice(0, limit);
}

module.exports = { rankCandidates, scoreKey, levenshtein, KIND_PRIORITY };
