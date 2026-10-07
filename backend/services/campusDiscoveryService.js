const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Entrance = require("../models/Entrance");
const Landmark = require("../models/Landmark");
const Category = require("../models/Category");

async function discoverCampus({ campusId, query = "" }) {
  const normalized = query.trim().toLowerCase();
  const [buildings, rooms, floors, entrances, landmarks, categories] = await Promise.all([
    Building.find({ campusId, isActive: true }).lean(),
    Room.find({ campusId, isActive: true }).lean(),
    Floor.find({ campusId }).lean(),
    Entrance.find({ campusId }).lean(),
    Landmark.find({ campusId, isActive: true }).lean(),
    Category.find({ isActive: true }).lean(),
  ]);

  const items = [];
  for (const building of buildings) {
    const buildingRooms = rooms.filter((room) => String(room.buildingId) === String(building._id));
    items.push({ kind: "building", id: String(building._id), name: building.name, category: building.type || "building", aliases: building.aliases || [], campusId, dataSource: building.dataSource, searchText: `${building.name} ${building.abbreviation || ""} ${(building.aliases || []).join(" ")}`.toLowerCase(), details: { description: building.description, coordinates: [building.longitude, building.latitude] } });
    for (const room of buildingRooms) {
      const floor = floors.find((candidate) => String(candidate._id) === String(room.floorId));
      items.push({ kind: "room", id: String(room._id), name: room.name, category: room.type || "room", aliases: room.aliases || [], campusId, dataSource: room.dataSource, searchText: `${room.name} ${room.roomNumber || ""} ${(room.aliases || []).join(" ")} ${floor?.name || ""}`.toLowerCase(), details: { floor: floor?.name || null, roomNumber: room.roomNumber, capacity: room.capacity } });
    }
  }

  for (const entrance of entrances) {
    items.push({ kind: "entrance", id: String(entrance._id), name: entrance.name, category: entrance.type || "entrance", aliases: [], campusId, dataSource: entrance.dataSource, searchText: `${entrance.name} ${entrance.type || ""}`.toLowerCase(), details: { latitude: entrance.latitude, longitude: entrance.longitude } });
  }

  for (const landmark of landmarks) {
    items.push({ kind: "landmark", id: String(landmark._id), name: landmark.name, category: landmark.type || "landmark", aliases: landmark.aliases || [], campusId, dataSource: landmark.dataSource, searchText: `${landmark.name} ${(landmark.aliases || []).join(" ")}`.toLowerCase(), details: { description: landmark.description, latitude: landmark.latitude, longitude: landmark.longitude } });
  }

  return {
    categoryNames: categories.map((category) => category.name),
    items: items
      .filter((item) => !normalized || item.searchText.includes(normalized) || item.aliases.some((alias) => alias.toLowerCase().includes(normalized)))
      .slice(0, 100),
  };
}

module.exports = { discoverCampus };
