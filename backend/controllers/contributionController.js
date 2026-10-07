const Contribution = require("../models/Contribution");
const UploadedFile = require("../models/UploadedFile");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { submitContribution, attachEvidence, resubmitContribution, reviewContribution, listContributions } = require("../services/contributionService");

const create = asyncHandler(async (req, res) => {
  const contribution = await submitContribution({
    title: req.body.title,
    description: req.body.description || "",
    submitterId: req.user.id,
    campusId: req.body.campusId,
    targetModel: req.body.targetModel,
    targetId: req.body.targetId,
    proposedChanges: req.body.proposedChanges,
    evidenceFileIds: req.body.evidenceFileIds || [],
  });
  res.status(201).json(contribution);
});

const attach = asyncHandler(async (req, res) => {
  const contribution = await attachEvidence(req.params.id, req.body.fileIds || [], req.user.id);
  res.status(200).json(contribution);
});

const resubmit = asyncHandler(async (req, res) => {
  const contribution = await resubmitContribution({
    contributionId: req.params.id,
    userId: req.user.id,
    title: req.body.title,
    description: req.body.description || "",
    targetModel: req.body.targetModel,
    targetId: req.body.targetId,
    proposedChanges: req.body.proposedChanges,
    evidenceFileIds: req.body.evidenceFileIds || [],
  });
  res.status(200).json(contribution);
});

const review = asyncHandler(async (req, res) => {
  const contribution = await reviewContribution({
    contributionId: req.params.id,
    action: req.body.action,
    actorId: req.user.id,
    actorRole: req.user.role,
    campusIds: req.user.campusIds,
    notes: req.body.notes || "",
  });
  res.status(200).json(contribution);
});

const list = asyncHandler(async (req, res) => {
  const contributions = await listContributions({
    user: req.user,
    query: req.query.q,
    status: req.query.status,
    campusId: req.query.campusId,
  });
  res.status(200).json({ results: contributions });
});

const mine = asyncHandler(async (req, res) => {
  const contributions = await Contribution.find({ submitterId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ results: contributions });
});

const evidence = asyncHandler(async (req, res) => {
  const files = await UploadedFile.find({ _id: { $in: req.params.id.split(",") }, ownerId: req.user.id, status: { $ne: "deleted" } }).lean();
  res.status(200).json({ results: files });
});

module.exports = { create, attach, resubmit, review, list, mine, evidence };
