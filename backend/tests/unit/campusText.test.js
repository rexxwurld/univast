const { normalizeText, canonicalKey, buildKeys } = require("../../utils/campusText");
const { resolveCategory } = require("../../utils/campusCategories");

describe("normalizeText", () => {
  it("lowercases, strips accents and punctuation, collapses whitespace", () => {
    expect(normalizeText("  Café   &  Bar! ")).toBe("cafe and bar");
  });
  it("handles null/undefined", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});

describe("canonicalKey", () => {
  it.each([
    ["LT1"], ["lt1"], ["LT 1"], ["L.T. 1"], ["Lecture Theatre 1"], ["Lecture Theater 1"], ["lecture  theatre   1"],
  ])("maps %s to lt1", (input) => {
    expect(canonicalKey(input)).toBe("lt1");
  });

  it("treats room numbers consistently", () => {
    expect(canonicalKey("Room 104")).toBe("rm104");
    expect(canonicalKey("Rm. 104")).toBe("rm104");
  });

  it("drops stop words but keeps single letters (Hostel A must stay distinct)", () => {
    expect(canonicalKey("The Main Library")).toBe("main library");
    expect(canonicalKey("Faculty of Science")).toBe("faculty science");
    expect(canonicalKey("Hostel A")).toBe("hostel a");
    expect(canonicalKey("Hostel B")).not.toBe(canonicalKey("Hostel A"));
  });

  it("unifies spelling variants and abbreviations", () => {
    expect(canonicalKey("Health Center")).toBe(canonicalKey("Health Centre"));
    expect(canonicalKey("Administrative Block")).toBe(canonicalKey("Admin Block"));
  });

  it("does not merge different lecture theatres", () => {
    expect(canonicalKey("LT1")).not.toBe(canonicalKey("LT2"));
    expect(canonicalKey("LT1")).not.toBe(canonicalKey("LT10"));
  });

  it("returns empty for empty input", () => {
    expect(canonicalKey("")).toBe("");
    expect(canonicalKey("   ")).toBe("");
  });
});

describe("buildKeys", () => {
  it("dedupes equivalent aliases", () => {
    expect(buildKeys(["LT1", "Lecture Theatre 1", "Lecture Theater 1", "Test LT1", ""])).toEqual(["lt1", "test lt1"]);
  });
});

describe("resolveCategory", () => {
  it("recognises whole-query category words", () => {
    expect(resolveCategory("Hostels")).toBe("hostel");
    expect(resolveCategory("lecture theaters")).toBe("lecture_hall");
    expect(resolveCategory("Health Centre")).toBe("health");
    expect(resolveCategory("faculties")).toBe("faculty");
  });
  it("does not treat a specific place as a category", () => {
    expect(resolveCategory("LT1")).toBeNull();
    expect(resolveCategory("admin block")).toBeNull();
    expect(resolveCategory("Hostel A")).toBeNull();
  });
});
