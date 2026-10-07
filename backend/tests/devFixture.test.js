const University = require("../models/University");
const Campus = require("../models/Campus");
const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Entrance = require("../models/Entrance");
const Landmark = require("../models/Landmark");
const Location = require("../models/Location");
const NavigationNode = require("../models/NavigationNode");
const NavigationEdge = require("../models/NavigationEdge");
const CampusPack = require("../models/CampusPack");
const { seedDevFixture, removeDevFixture } = require("../seeds/devFixture");
const { connect, closeDatabase, clearDatabase } = require("./testDb");

beforeAll(async () => {
  await connect();
});
afterEach(async () => {
  await clearDatabase();
});
afterAll(async () => {
  await closeDatabase();
});

const ALL = [University, Campus, Building, Floor, Room, Entrance, Landmark, Location, NavigationNode, NavigationEdge, CampusPack];
const counts = async () => Promise.all(ALL.map((M) => M.countDocuments({})));

/** A small "real" campus that must survive any fixture removal. */
async function createRealCampus() {
  const uni = await University.create({ name: "Real University", ShortName: "RU", country: "X", state: "Y" });
  const campus = await Campus.create({ universityId: uni._id, name: "Real Campus", latitude: 6.5, longitude: 3.4 });
  const building = await Building.create({ campusId: campus._id, name: "Real Block", latitude: 6.5, longitude: 3.4 });
  const floor = await Floor.create({ campusId: campus._id, buildingId: building._id, floorNumber: 1 });
  const room = await Room.create({ campusId: campus._id, buildingId: building._id, floorId: floor._id, name: "Room 1" });
  const node = await NavigationNode.create({ campusId: campus._id, name: "n", latitude: 6.5, longitude: 3.4 });
  return { uni, campus, building, floor, room, node };
}

describe("DEV_FIXTURE removal", () => {
  it("removes every fixture record (including a published pack) and leaves nothing behind", async () => {
    await seedDevFixture({ publish: true });
    expect((await counts()).every((n) => n > 0)).toBe(true);
    const removed = await removeDevFixture();
    expect(removed.Campus).toBe(1);
    expect(removed.CampusPack).toBe(1);
    expect(await counts()).toEqual(ALL.map(() => 0));
  });

  it("never touches real data that coexists with the fixture", async () => {
    const real = await createRealCampus();
    await seedDevFixture();
    await removeDevFixture();
    expect(await University.countDocuments({})).toBe(1);
    expect(await Campus.findById(real.campus._id)).toBeTruthy();
    expect(await Building.findById(real.building._id)).toBeTruthy();
    expect(await Room.findById(real.room._id)).toBeTruthy();
    expect(await NavigationNode.findById(real.node._id)).toBeTruthy();
  });

  it("refuses to remove when someone added real data under the fixture campus", async () => {
    const f = await seedDevFixture();
    await Building.create({ campusId: f.campusId, name: "Hand-mapped Block", latitude: 0, longitude: 0 }); // dataSource: manual
    await expect(removeDevFixture()).rejects.toThrow(/Refusing to remove DEV_FIXTURE/);
    expect(await Campus.countDocuments({})).toBe(1);
  });

  it("removes everything when forced", async () => {
    const f = await seedDevFixture();
    await Building.create({ campusId: f.campusId, name: "Hand-mapped Block", latitude: 0, longitude: 0 });
    await removeDevFixture({ force: true });
    expect(await counts()).toEqual(ALL.map(() => 0));
  });

  it("can be re-seeded after removal, and removal of an empty database is a no-op", async () => {
    await expect(removeDevFixture()).resolves.toBeTruthy();
    const first = await seedDevFixture();
    await removeDevFixture();
    const second = await seedDevFixture();
    expect(second.created).toBe(true);
    expect(String(second.campusId)).not.toBe(String(first.campusId));
  });
});

describe("DEV_FIXTURE is unmistakably synthetic", () => {
  it("uses coordinates near (0,0) and says DEV_FIXTURE in descriptions", async () => {
    const f = await seedDevFixture();
    const campus = await Campus.findById(f.campusId);
    expect(Math.abs(campus.latitude)).toBeLessThan(0.01);
    expect(Math.abs(campus.longitude)).toBeLessThan(0.01);
    expect(campus.description).toMatch(/DEV_FIXTURE/);
    const room = await Room.findById(f.roomId);
    expect(room.description).toMatch(/DEV_FIXTURE/);
    expect(room.verificationNotes).toMatch(/DEV_FIXTURE/);
  });
});
