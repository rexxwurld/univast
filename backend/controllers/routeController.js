const routingService = require("../services/routingService");
const asyncHandler = require("../utils/asyncHandler");

const getShortestRoute = asyncHandler(async (req, res) => {
  const { campusId, startNodeId, endNodeId } = req.body;
  const result = await routingService.getShortestRoute({ campusId, startNodeId, endNodeId });
  res.status(200).json(result);
});

const getNearestNode = asyncHandler(async (req, res) => {
  const { campusId, latitude, longitude } = req.body;
  const result = await routingService.findNearestNode({ campusId, latitude, longitude });
  res.status(200).json(result);
});

module.exports = { getShortestRoute, getNearestNode };
