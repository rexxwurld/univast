const { generateInstructions, describeTurn, turnAngle, bearing, roundMeters, floorLabel } = require("../../services/instructionService");

const n = (id, name, type, latitude, longitude) => ({ id, name, type, latitude, longitude });

// gate --E--> junction --N--> library --N--> bend --W--> entrance
const nodes = [
  n("gate", "Demo Main Gate", "landmark", 0, 0),
  n("jn", "Demo Junction", "intersection", 0, 0.0009),
  n("lib", "Demo Library", "landmark", 0.0005, 0.0009),
  n("bend", "", "intersection", 0.001, 0.0009),
  n("ent", "Main Entrance", "entrance", 0.001, 0.0004),
];

const destination = {
  kind: "room", name: "LT1", roomName: "LT1", buildingName: "Test Science Block", entranceName: "Main Entrance",
  floor: { floorNumber: 0, name: "Ground Floor" },
};

describe("geometry helpers", () => {
  it("bearing: east = 90, north = 0", () => {
    expect(Math.round(bearing(n("a", "", "x", 0, 0), n("b", "", "x", 0, 0.001)))).toBe(90);
    expect(Math.round(bearing(n("a", "", "x", 0, 0), n("b", "", "x", 0.001, 0)))).toBe(0);
  });
  it("turnAngle: east->north is a left turn (-90)", () => {
    expect(Math.round(turnAngle(90, 0))).toBe(-90);
    expect(Math.round(turnAngle(350, 10))).toBe(20);
  });
  it("describeTurn classifies by angle", () => {
    expect(describeTurn(10)).toBeNull();
    expect(describeTurn(-40)).toBe("slight left");
    expect(describeTurn(90)).toBe("right");
    expect(describeTurn(-150)).toBe("sharp left");
  });
  it("rounds to 5 m with a 5 m floor", () => {
    expect(roundMeters(102)).toBe(100);
    expect(roundMeters(1)).toBe(5);
  });
  it("floorLabel", () => {
    expect(floorLabel({ floorNumber: 0 })).toBe("ground floor");
    expect(floorLabel({ floorNumber: 2 })).toBe("floor 2");
    expect(floorLabel({ floorNumber: 1, name: "First Floor" })).toBe("First Floor");
    expect(floorLabel(undefined)).toBeNull();
  });
});

describe("generateInstructions", () => {
  const steps = generateInstructions({ nodes, start: { mode: "node" }, destination });
  const text = steps.map((s) => s.text);

  it("departs naming the start and the first landmark ahead", () => {
    expect(text[0]).toBe("Walk from Demo Main Gate toward Demo Junction.");
  });
  it("uses the named junction for the first turn", () => {
    expect(text.some((t) => /turn left at Demo Junction/.test(t))).toBe(true);
  });
  it("mentions the landmark it passes", () => {
    expect(text).toContain("Continue straight past Demo Library.");
  });
  it("turns at an unnamed bend without inventing a name", () => {
    expect(text.some((t) => /turn left\.$/.test(t))).toBe(true);
  });
  it("ends with entering the building and the floor of the room", () => {
    expect(text).toContain("Enter Test Science Block through Main Entrance.");
    expect(text[text.length - 1]).toMatch(/^LT1 is on the Ground Floor\./);
  });
  it("adds a snap step only when starting from coordinates far enough from the path", () => {
    const far = generateInstructions({ nodes, start: { mode: "coordinates", snapDistanceMeters: 42 }, destination });
    expect(far[0].type).toBe("start");
    expect(far[0].text).toMatch(/Walk about 40 m to the nearest path/);
    const near = generateInstructions({ nodes, start: { mode: "coordinates", snapDistanceMeters: 4 }, destination });
    expect(near[0].type).toBe("depart");
  });
  it("handles a landmark destination", () => {
    const s = generateInstructions({ nodes: nodes.slice(0, 3), destination: { kind: "landmark", name: "Demo Library" } });
    expect(s[s.length - 1].text).toBe("You have arrived at Demo Library.");
  });
  it("returns [] for no nodes and doesn't crash on one node", () => {
    expect(generateInstructions({ nodes: [] })).toEqual([]);
    expect(generateInstructions({ nodes: [nodes[0]], destination: { kind: "landmark", name: "Here" } })).toHaveLength(1);
  });
});

// ---- Phase 5: structured steps ------------------------------------------------------------------------------
describe("generateInstructions (structured steps)", () => {
  const nodes5 = [
    { id: "gate", name: "Demo Main Gate", type: "landmark", latitude: 0, longitude: 0, distanceToNext: 100 },
    { id: "jn", name: "Demo Junction", type: "intersection", latitude: 0, longitude: 0.0009, distanceToNext: 56 },
    { id: "lib", name: "Demo Library", type: "landmark", latitude: 0.0005, longitude: 0.0009, distanceToNext: 56 },
    { id: "bend", name: "", type: "intersection", latitude: 0.001, longitude: 0.0009, distanceToNext: 56 },
    { id: "ent", name: "Main Entrance", type: "entrance", latitude: 0.001, longitude: 0.0004 },
  ];
  const dest = { kind: "room", name: "LT1", roomName: "LT1", buildingName: "Test Science Block", entranceName: "Main Entrance", floor: { floorNumber: 0, name: "Ground Floor" } };

  it("adds maneuver, position, geometry index and cumulative distance to every step", () => {
    const steps = generateInstructions({ nodes: nodes5, start: { mode: "node" }, destination: dest, options: { speedMetersPerSecond: 1.4 } });
    const turn = steps.find((s) => s.text.includes("Demo Junction") && s.maneuver === "turn_left");
    expect(turn.geometryIndex).toBe(1);
    expect(turn.distanceFromStartMeters).toBe(100);
    expect(turn.at).toEqual({ latitude: 0, longitude: 0.0009 });
    expect(turn.durationSeconds).toBe(71); // 100 m at 1.4 m/s, rounded
    expect(steps[0].maneuver).toBe("depart");
    expect(steps[steps.length - 1].maneuver).toBe("arrive");
  });

  it("uses the stored edge length for distances and offsets the geometry when the route starts from coordinates", () => {
    const steps = generateInstructions({
      nodes: nodes5,
      start: { mode: "coordinates", snapDistanceMeters: 40, position: { latitude: 0.0001, longitude: 0 } },
      destination: dest,
      options: { speedMetersPerSecond: 1.4, startOffsetMeters: 40, indexOffset: 1 },
    });
    expect(steps[0].type).toBe("start");
    expect(steps[0].geometryIndex).toBe(0);
    const turn = steps.find((s) => s.maneuver === "turn_left" && s.text.includes("Demo Junction"));
    expect(turn.geometryIndex).toBe(2);
    expect(turn.distanceFromStartMeters).toBe(140); // 40 m to the path + 100 m
    const enter = steps.find((s) => s.maneuver === "enter_building");
    expect(enter.building).toBe("Test Science Block");
    expect(enter.entrance).toBe("Main Entrance");
  });

  it("merges a small direction change into a continuation (no turn step)", () => {
    const wiggle = [
      { id: "a", name: "", latitude: 0, longitude: 0, distanceToNext: 50 },
      { id: "b", name: "", latitude: 0.00002, longitude: 0.00045, distanceToNext: 50 }, // ~2.5 degrees off straight
      { id: "c", name: "End", type: "landmark", latitude: 0, longitude: 0.0009 },
    ];
    const steps = generateInstructions({ nodes: wiggle, destination: { kind: "landmark", name: "End" } });
    expect(steps.some((s) => String(s.maneuver).includes("turn"))).toBe(false);
  });

  it("describes a reversal as a U-turn and keeps sharp turns distinct", () => {
    expect(describeTurn(170)).toBe("u-turn");
    expect(describeTurn(-130)).toBe("sharp left");
    const back = [
      { id: "a", name: "A", latitude: 0, longitude: 0, distanceToNext: 50 },
      { id: "b", name: "B", latitude: 0, longitude: 0.00045, distanceToNext: 50 },
      { id: "c", name: "C", latitude: 0.000001, longitude: 0 },
    ];
    const steps = generateInstructions({ nodes: back, destination: { kind: "landmark", name: "C" } });
    expect(steps.find((s) => s.maneuver === "u_turn").text).toMatch(/make a U-turn at B/);
  });

  it("emits one 'take the stairs' step with the target floor, and none for outdoor-only paths", () => {
    const indoor = [
      { id: "door", name: "Main Entrance", type: "entrance", latitude: 0, longitude: 0, distanceToNext: 20, edgeType: "path", floorLabel: "Ground Floor" },
      { id: "foot", name: "", type: "stairs", latitude: 0, longitude: 0.0002, distanceToNext: 8, edgeType: "stairs", floorLabel: "Ground Floor" },
      { id: "mid", name: "", type: "stairs", latitude: 0, longitude: 0.00021, distanceToNext: 8, edgeType: "stairs", floorLabel: "Ground Floor" },
      { id: "top", name: "", type: "stairs", latitude: 0, longitude: 0.00022, distanceToNext: 15, edgeType: "path", floorLabel: "First Floor" },
      { id: "room", name: "LT2", type: "poi", latitude: 0, longitude: 0.0004, floorLabel: "First Floor" },
    ];
    const steps = generateInstructions({ nodes: indoor, destination: { kind: "room", name: "LT2", roomName: "LT2", buildingName: "Block", floor: { floorNumber: 1, name: "First Floor" }, indoorRouted: true } });
    const stairs = steps.filter((s) => s.maneuver === "take_stairs");
    expect(stairs).toHaveLength(1);
    expect(stairs[0].text).toMatch(/take the stairs to the First Floor/i);
    expect(stairs[0].floor).toBe("First Floor");
    expect(steps[steps.length - 1].text).toBe("LT2 is on the First Floor."); // indoor-routed: no "not available yet" disclaimer
  });

  it("uses a named landmark attached to an unnamed node, and ramps/elevators get their own maneuver", () => {
    const nodes = [
      { id: "a", name: "", latitude: 0, longitude: 0, distanceToNext: 60 },
      { id: "b", name: "", landmark: "Student Centre", latitude: 0, longitude: 0.00054, distanceToNext: 60 },
      { id: "c", name: "", latitude: 0, longitude: 0.001, edgeType: "ramp", distanceToNext: 10, floorLabel: "Ground Floor" },
      { id: "d", name: "Hall", type: "poi", latitude: 0, longitude: 0.0011, floorLabel: "First Floor" },
    ];
    nodes[1].edgeType = "path";
    nodes[0].edgeType = "path";
    const steps = generateInstructions({ nodes, destination: { kind: "landmark", name: "Hall" } });
    expect(steps.some((s) => s.text === "Continue straight past Student Centre.")).toBe(true);
    expect(steps.find((s) => s.maneuver === "take_ramp").text).toMatch(/take the ramp to the First Floor/i);
  });

  it("adds a 'leave the building' step when the route starts at an entrance", () => {
    const steps = generateInstructions({
      nodes: nodes5.slice(3),
      start: { mode: "entrance", exit: { buildingName: "Test Science Block", entranceName: "North Entrance" } },
      destination: { kind: "landmark", name: "Main Entrance" },
    });
    expect(steps[0].maneuver).toBe("exit_building");
    expect(steps[0].text).toBe("Leave Test Science Block through North Entrance.");
  });
});
