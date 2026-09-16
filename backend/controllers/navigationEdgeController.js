const NavigationEdge = require("../models/NavigationEdge");
const NavigationNode = require("../models/NavigationNode");
const Campus = require("../models/Campus");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const getAll = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.campusId) filter.campusId = req.query.campusId;

  const edges = await NavigationEdge.find(filter).sort({ createdAt: 1 });
  res.status(200).json(edges);
});

const getOne = asyncHandler(async (req, res) => {
  const edge = await NavigationEdge.findById(req.params.id);
  if (!edge) {
    throw new ApiError(404, "Navigation edge not found");
  }
  res.status(200).json(edge);
});

/**
 * Checks whether an edge already connects `from` and `to` on this campus,
 * accounting for the fact that an existing bidirectional A->B edge already
 * covers a request for B->A (the unique DB index alone can't express that).
 */
async function findConflictingEdge({ campusId, from, to, excludeId }) {
  const query = {
    campusId,
    $or: [
      { from, to },
      { from: to, to: from, bidirectional: true },
    ],
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  return NavigationEdge.findOne(query);
}

const create = asyncHandler(async (req, res) => {
  const { campusId, from, to, distance, bidirectional } = req.body;

  if (from === to) {
    throw new ApiError(400, "from and to must reference different navigation nodes");
  }

  const campus = await Campus.findById(campusId);
  if (!campus) {
    throw new ApiError(400, `campusId '${campusId}' does not reference an existing Campus`);
  }

  const [fromNode, toNode] = await Promise.all([
    NavigationNode.findById(from),
    NavigationNode.findById(to),
  ]);
  if (!fromNode) {
    throw new ApiError(400, `from '${from}' does not reference an existing NavigationNode`);
  }
  if (!toNode) {
    throw new ApiError(400, `to '${to}' does not reference an existing NavigationNode`);
  }

  const conflict = await findConflictingEdge({ campusId, from, to });
  if (conflict) {
    throw new ApiError(409, "An edge already connects these two navigation nodes on this campus");
  }

  const edge = await NavigationEdge.create({
    campusId,
    from,
    to,
    distance,
    bidirectional: bidirectional !== undefined ? bidirectional : true,
  });
  res.status(201).json(edge);
});

const update = asyncHandler(async (req, res) => {
  const existing = await NavigationEdge.findById(req.params.id);
  if (!existing) {
    throw new ApiError(404, "Navigation edge not found");
  }

  const { campusId, from, to, distance, bidirectional } = req.body;

  const nextCampusId = campusId !== undefined ? campusId : existing.campusId;
  const nextFrom = from !== undefined ? from : existing.from;
  const nextTo = to !== undefined ? to : existing.to;

  if (String(nextFrom) === String(nextTo)) {
    throw new ApiError(400, "from and to must reference different navigation nodes");
  }

  if (campusId !== undefined) {
    const campus = await Campus.findById(campusId);
    if (!campus) {
      throw new ApiError(400, `campusId '${campusId}' does not reference an existing Campus`);
    }
  }
  if (from !== undefined) {
    const fromNode = await NavigationNode.findById(from);
    if (!fromNode) {
      throw new ApiError(400, `from '${from}' does not reference an existing NavigationNode`);
    }
  }
  if (to !== undefined) {
    const toNode = await NavigationNode.findById(to);
    if (!toNode) {
      throw new ApiError(400, `to '${to}' does not reference an existing NavigationNode`);
    }
  }

  if (from !== undefined || to !== undefined || campusId !== undefined) {
    const conflict = await findConflictingEdge({
      campusId: nextCampusId,
      from: nextFrom,
      to: nextTo,
      excludeId: existing._id,
    });
    if (conflict) {
      throw new ApiError(409, "An edge already connects these two navigation nodes on this campus");
    }
  }

  const update = {};
  if (campusId !== undefined) update.campusId = campusId;
  if (from !== undefined) update.from = from;
  if (to !== undefined) update.to = to;
  if (distance !== undefined) update.distance = distance;
  if (bidirectional !== undefined) update.bidirectional = bidirectional;

  const edge = await NavigationEdge.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  });
  res.status(200).json(edge);
});

const remove = asyncHandler(async (req, res) => {
  const edge = await NavigationEdge.findByIdAndDelete(req.params.id);
  if (!edge) {
    throw new ApiError(404, "Navigation edge not found");
  }
  res.status(200).json({ message: "Navigation edge deleted", id: req.params.id });
});

module.exports = { getAll, getOne, create, update, remove };
