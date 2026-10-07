// Pure part of the graph cache (filterEdges). Requiring the module also loads Mongoose models, which only
// the real test run (npm install) has — so this file is skipped in environments without dependencies.
let filterEdges;
try { ({ filterEdges } = require("../../services/graphCache")); } catch (e) { filterEdges = null; }
const maybe = filterEdges ? describe : (name, fn) => {};

maybe("filterEdges", () => {
  const nodes = new Map([
    ["out", { _id: "out" }],
    ["g1", { _id: "g1", floorId: "F0" }],
    ["g2", { _id: "g2", floorId: "F0" }],
    ["u1", { _id: "u1", floorId: "F1" }],
  ]);
  const edge = (from, to, extra = {}) => ({ from, to, distance: 10, bidirectional: true, type: "path", isRestricted: false, isAccessible: null, ...extra });

  it("drops restricted edges always", () => {
    const { usable, ignored } = filterEdges([edge("out", "g1"), edge("g1", "g2", { isRestricted: true })], nodes, { accessibleOnly: false });
    expect(usable).toHaveLength(1);
    expect(ignored.restricted).toBe(1);
  });
  it("drops stairs and explicitly inaccessible edges only for accessible-only routing; unknown stays allowed", () => {
    const edges = [edge("g1", "u1", { type: "stairs" }), edge("g1", "g2", { isAccessible: false }), edge("out", "g1", { isAccessible: null })];
    expect(filterEdges(edges, nodes, { accessibleOnly: false }).usable).toHaveLength(3);
    const strict = filterEdges(edges, nodes, { accessibleOnly: true });
    expect(strict.usable).toHaveLength(1);
    expect(strict.ignored.inaccessible).toBe(2);
  });
  it("ignores a plain path between different floors but allows stairs, ramps and elevators", () => {
    const edges = [edge("g1", "u1"), edge("g1", "u1", { type: "stairs" }), edge("g1", "u1", { type: "ramp" }), edge("g1", "u1", { type: "elevator" })];
    const { usable, ignored } = filterEdges(edges, nodes, { accessibleOnly: false });
    expect(usable).toHaveLength(3);
    expect(ignored.invalidFloorTransition).toBe(1);
  });
  it("allows a path between outdoors and a floor (that is just a doorway)", () => {
    expect(filterEdges([edge("out", "g1")], nodes, { accessibleOnly: false }).usable).toHaveLength(1);
  });
});
