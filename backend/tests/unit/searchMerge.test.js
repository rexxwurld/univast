const { mergeGeoResults, isDuplicate } = require("../../utils/searchMerge");

const row = (over = {}) => ({ id: "osm:node:1", name: "Main Gate", displayName: "Main Gate, Somewhere", category: "place", type: "gate", latitude: 4.9500, longitude: 8.3200, ...over });

describe("mergeGeoResults", () => {
  it("keeps UNIVAST results first and appends geo hits after them", () => {
    const univast = [{ kind: "building", name: "Science Block", latitude: 1, longitude: 1 }];
    const merged = mergeGeoResults(univast, [row()]);
    expect(merged[0]).toBe(univast[0]);
    expect(merged[1]).toMatchObject({ kind: "geo", name: "Main Gate", dataSource: "geocoder" });
  });

  it("drops a geo hit that is the same place as a UNIVAST result (same name, within ~75 m)", () => {
    const univast = [{ kind: "landmark", name: "Main Gate", latitude: 4.95002, longitude: 8.32002 }];
    expect(mergeGeoResults(univast, [row()])).toHaveLength(1);
  });

  it("keeps a geo hit with the same name that is far away", () => {
    const univast = [{ kind: "landmark", name: "Main Gate", latitude: 6.5, longitude: 3.4 }];
    expect(mergeGeoResults(univast, [row()])).toHaveLength(2);
  });

  it("caps geo hits, removes repeated ids and ignores bad rows", () => {
    const rows = Array.from({ length: 9 }, (_, i) => row({ id: `osm:node:${i}`, name: `Place ${i}`, latitude: 10 + i }));
    const merged = mergeGeoResults([], [...rows, rows[0], null]);
    expect(merged).toHaveLength(5);
  });

  it("handles a missing geo list", () => {
    expect(mergeGeoResults([{ kind: "room", name: "LT1" }], undefined)).toHaveLength(1);
  });

  it("isDuplicate ignores UNIVAST results without coordinates", () => {
    expect(isDuplicate(row(), [{ name: "Main Gate" }])).toBe(false);
  });
});
