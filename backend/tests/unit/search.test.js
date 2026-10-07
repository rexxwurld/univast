const { rankCandidates, scoreKey, levenshtein } = require("../../utils/search");
const { buildKeys } = require("../../utils/campusText");

const cand = (kind, name, aliases = [], extra = {}) => ({ kind, id: name, name, keys: buildKeys([name, ...aliases]), ...extra });

const sci = cand("building", "Test Science Block", ["Old Science Block", "Test Science"]);
const lt1 = cand("room", "LT1", ["Lecture Theatre 1", "Test LT1"], { contextKeys: sci.keys, category: "lecture_hall" });
const lt2 = cand("room", "LT2", ["Lecture Theatre 2"], { contextKeys: sci.keys });
const lt10 = cand("room", "LT10", [], { contextKeys: sci.keys });
const library = cand("landmark", "Main Library", ["Library"]);
const all = [sci, lt1, lt2, lt10, library];

const top = (q) => (rankCandidates(q, all)[0] || {}).candidate;

describe("rankCandidates", () => {
  it.each(["LT1", "lt1", "LT 1", "Lecture Theatre 1", "Lecture Theater 1", "Test LT1"])("resolves %s to LT1", (q) => {
    expect(top(q).name).toBe("LT1");
  });

  it("never confuses LT1 with LT2 or LT10 (no fuzzy matching on digits)", () => {
    const names = rankCandidates("LT1", all).map((r) => r.candidate.name);
    expect(names[0]).toBe("LT1");
    expect(names).not.toContain("LT2");
  });

  it("finds buildings by alias and partial name", () => {
    expect(top("Old Science").name).toBe("Test Science Block");
    expect(top("old sci").name).toBe("Test Science Block");
    expect(top("science block").name).toBe("Test Science Block");
  });

  it("uses building context: 'science lt1' finds LT1", () => {
    expect(top("science lt1").name).toBe("LT1");
  });

  it("tolerates a typo in a long non-numeric name", () => {
    expect(top("Libary").name).toBe("Main Library");
  });

  it("returns nothing for unrelated or empty queries", () => {
    expect(rankCandidates("xyzzy plugh", all)).toEqual([]);
    expect(rankCandidates("", all)).toEqual([]);
    expect(rankCandidates("   ", all)).toEqual([]);
  });

  it("prefers rooms over buildings on an exact tie", () => {
    const a = cand("building", "Annex", ["Hall 1"]);
    const b = cand("room", "Hall 1", []);
    const [first] = rankCandidates("hall 1", [a, b]);
    expect(first.candidate.kind).toBe("room");
  });
});

describe("scoreKey / levenshtein", () => {
  it("exact is 100", () => {
    expect(scoreKey("lt1", ["lt1"], "lt1")).toBe(100);
  });
  it("levenshtein caps early", () => {
    expect(levenshtein("kitten", "sitting", 1)).toBeGreaterThan(1);
    expect(levenshtein("library", "libary", 1)).toBe(1);
  });
});
