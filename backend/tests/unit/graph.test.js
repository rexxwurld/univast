const { buildGraph, dijkstra } = require("../../utils/graph");

const nodes = ["A", "B", "C", "D", "E"].map((id) => ({ _id: id }));

describe("buildGraph", () => {
  it("creates an entry for every node, even isolated ones", () => {
    const graph = buildGraph(nodes, []);
    expect([...graph.keys()]).toEqual(["A", "B", "C", "D", "E"]);
    expect(graph.get("A")).toEqual([]);
  });

  it("adds both directions for bidirectional edges", () => {
    const graph = buildGraph(nodes, [{ from: "A", to: "B", distance: 5, bidirectional: true }]);
    expect(graph.get("A")).toEqual([{ to: "B", distance: 5 }]);
    expect(graph.get("B")).toEqual([{ to: "A", distance: 5 }]);
  });

  it("adds only one direction for one-way edges", () => {
    const graph = buildGraph(nodes, [{ from: "A", to: "B", distance: 5, bidirectional: false }]);
    expect(graph.get("A")).toHaveLength(1);
    expect(graph.get("B")).toHaveLength(0);
  });

  it("skips edges that reference unknown nodes instead of throwing", () => {
    const graph = buildGraph(nodes, [{ from: "A", to: "ZZZ", distance: 1, bidirectional: true }]);
    expect(graph.get("A")).toEqual([]);
  });

  it("accepts nodes keyed by `id` as well as `_id`", () => {
    const graph = buildGraph([{ id: "X" }, { id: "Y" }], [{ from: "X", to: "Y", distance: 2, bidirectional: true }]);
    expect(graph.get("X")).toEqual([{ to: "Y", distance: 2 }]);
  });
});

describe("dijkstra", () => {
  //   A --1-- B --1-- C
  //   |               |
  //   +-------5-------+      (direct A-C is longer than A-B-C)
  //   C --2-- D        E is isolated
  const edges = [
    { from: "A", to: "B", distance: 1, bidirectional: true },
    { from: "B", to: "C", distance: 1, bidirectional: true },
    { from: "A", to: "C", distance: 5, bidirectional: true },
    { from: "C", to: "D", distance: 2, bidirectional: true },
  ];
  const graph = buildGraph(nodes, edges);

  it("prefers the shorter multi-hop path over a longer direct edge", () => {
    expect(dijkstra(graph, "A", "C")).toEqual({ distance: 2, path: ["A", "B", "C"] });
  });

  it("returns the full ordered path across several hops", () => {
    expect(dijkstra(graph, "A", "D")).toEqual({ distance: 4, path: ["A", "B", "C", "D"] });
  });

  it("returns a zero-length path when start equals end", () => {
    expect(dijkstra(graph, "B", "B")).toEqual({ distance: 0, path: ["B"] });
  });

  it("returns null when the destination is unreachable", () => {
    expect(dijkstra(graph, "A", "E")).toBeNull();
  });

  it("returns null when either node is not in the graph", () => {
    expect(dijkstra(graph, "A", "nope")).toBeNull();
    expect(dijkstra(graph, "nope", "A")).toBeNull();
  });

  it("respects one-way edges", () => {
    const oneWay = buildGraph(nodes, [{ from: "A", to: "B", distance: 1, bidirectional: false }]);
    expect(dijkstra(oneWay, "A", "B")).not.toBeNull();
    expect(dijkstra(oneWay, "B", "A")).toBeNull();
  });

  it("coerces ObjectId-like values to strings", () => {
    const objectIdLike = (s) => ({ toString: () => s });
    const g = buildGraph(
      [{ _id: objectIdLike("N1") }, { _id: objectIdLike("N2") }],
      [{ from: objectIdLike("N1"), to: objectIdLike("N2"), distance: 3, bidirectional: true }]
    );
    expect(dijkstra(g, objectIdLike("N1"), objectIdLike("N2"))).toEqual({ distance: 3, path: ["N1", "N2"] });
  });
});
