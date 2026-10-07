const crypto = require("crypto");
const mongoose = require("mongoose");
const Contribution = require("../models/Contribution");
const ContributionRewardConfig = require("../models/ContributionRewardConfig");
const UploadedFile = require("../models/UploadedFile");
const Building = require("../models/Building");
const Floor = require("../models/Floor");
const Room = require("../models/Room");
const Entrance = require("../models/Entrance");
const Landmark = require("../models/Landmark");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { markCampusDirty } = require("./campusPackService");

const MODEL_BY_NAME = {
  Building,
  Floor,
  Room,
  Entrance,
  Landmark,
};

function canonicalChangeDigest(changes) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(changes))).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

async function assertTargetOwnership(targetModel, targetId, campusId) {
  const Model = MODEL_BY_NAME[targetModel];
  if (!Model) throw new ApiError(400, "Unsupported contribution target");
  const target = await Model.findOne({ _id: targetId, campusId });
  if (!target) throw new ApiError(404, `${targetModel} not found for this campus`);
  return target;
}

async function duplicateKey(campusId, targetModel, targetId, submitterId, proposedChanges) {
  const digest = canonicalChangeDigest(proposedChanges);
  const seed = `${campusId}:${targetModel}:${targetId}:${submitterId}:${digest}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 64);
}

async function submitContribution({
  title,
  description,
  submitterId,
  campusId,
  targetModel,
  targetId,
  proposedChanges,
  evidenceFileIds = [],
}) {
  await assertTargetOwnership(targetModel, targetId, campusId);
  if (!proposedChanges || typeof proposedChanges !== "object" || Array.isArray(proposedChanges)) {
    throw new ApiError(400, "proposedChanges must be an object");
  }

  if (evidenceFileIds.length > 0) {
    const files = await UploadedFile.find({
      _id: { $in: evidenceFileIds },
      ownerId: submitterId,
      status: "quarantined",
      contributionId: null,
    }).select("_id");
    if (files.length !== new Set(evidenceFileIds.map(String)).size) {
      throw new ApiError(400, "One or more evidence files are unavailable or already attached");
    }
  }

  const normalized = { ...proposedChanges };
  delete normalized._id;
  delete normalized.__v;
  delete normalized.dataSource;
  delete normalized.campusId;

  const key = await duplicateKey(campusId, targetModel, targetId, submitterId, normalized);
  const existing = await Contribution.findOne({ duplicateKey: key, status: { $in: ["DRAFT", "SUBMITTED", "UNDER_REVIEW"] } });
  if (existing) throw new ApiError(409, "An identical pending contribution already exists");

  const contribution = await Contribution.create({
    title,
    description,
    submitterId,
    campusId,
    targetModel,
    targetId,
    status: "SUBMITTED",
    proposedChanges: normalized,
    evidenceFileIds,
    duplicateKey: key,
    history: [{ action: "SUBMITTED", actorId: submitterId, notes: "Contribution submitted for review", previousStatus: null, nextStatus: "SUBMITTED" }],
  });
  if (evidenceFileIds.length > 0) {
    const result = await UploadedFile.updateMany(
      { _id: { $in: evidenceFileIds }, ownerId: submitterId, status: "quarantined", contributionId: null },
      { $set: { contributionId: contribution._id } }
    );
    if (result.modifiedCount !== new Set(evidenceFileIds.map(String)).size) {
      await UploadedFile.updateMany({ contributionId: contribution._id }, { $set: { contributionId: null } });
      await Contribution.deleteOne({ _id: contribution._id });
      throw new ApiError(409, "Evidence files changed while the contribution was being submitted");
    }
  }
  return contribution;
}

async function attachEvidence(contributionId, fileIds, userId) {
  const contribution = await Contribution.findById(contributionId);
  if (!contribution) throw new ApiError(404, "Contribution not found");
  if (String(contribution.submitterId) !== userId) {
    throw new ApiError(403, "Only the submitter may attach evidence");
  }
  if (!["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"].includes(contribution.status)) {
    throw new ApiError(409, "Evidence cannot be attached to a finalized contribution");
  }

  const files = await UploadedFile.find({ _id: { $in: fileIds }, ownerId: userId, status: "quarantined", contributionId: null });
  if (files.length !== fileIds.length) throw new ApiError(400, "One or more evidence files are not available");

  const claimed = await UploadedFile.updateMany(
    { _id: { $in: fileIds }, ownerId: userId, status: "quarantined", contributionId: null },
    { $set: { contributionId } }
  );
  if (claimed.modifiedCount !== fileIds.length) {
    await UploadedFile.updateMany({ _id: { $in: fileIds }, contributionId }, { $set: { contributionId: null } });
    throw new ApiError(409, "Evidence files changed while they were being attached");
  }

  const previousEvidence = contribution.evidenceFileIds.map(String);
  contribution.evidenceFileIds = [...new Set([...previousEvidence, ...fileIds.map(String)])];
  try {
    await contribution.save();
  } catch (error) {
    await UploadedFile.updateMany({ _id: { $in: fileIds }, contributionId }, { $set: { contributionId: null } });
    throw error;
  }
  return contribution;
}

async function resubmitContribution({ contributionId, userId, title, description, targetModel, targetId, proposedChanges, evidenceFileIds = [] }) {
  const contribution = await Contribution.findOne({ _id: contributionId, submitterId: userId });
  if (!contribution) throw new ApiError(404, "Contribution not found");
  if (contribution.status !== "CHANGES_REQUESTED") throw new ApiError(409, "This contribution is not awaiting changes");
  if (contribution.targetModel !== targetModel || String(contribution.targetId) !== String(targetId)) {
    throw new ApiError(400, "A resubmission cannot change its target record");
  }
  await assertTargetOwnership(targetModel, targetId, contribution.campusId);

  const normalized = { ...proposedChanges };
  delete normalized._id;
  delete normalized.__v;
  delete normalized.dataSource;
  delete normalized.campusId;
  const key = await duplicateKey(contribution.campusId, targetModel, targetId, userId, normalized);
  const duplicate = await Contribution.findOne({ _id: { $ne: contributionId }, duplicateKey: key, status: { $in: ["DRAFT", "SUBMITTED", "UNDER_REVIEW"] } });
  if (duplicate) throw new ApiError(409, "An identical pending contribution already exists");

  const uniqueFileIds = [...new Set(evidenceFileIds.map(String))];
  let newlyClaimedFileIds = [];
  if (uniqueFileIds.length > 0) {
    const files = await UploadedFile.find({
      _id: { $in: uniqueFileIds },
      ownerId: userId,
      status: "quarantined",
      $or: [{ contributionId: null }, { contributionId }],
    }).select("_id contributionId");
    if (files.length !== uniqueFileIds.length) throw new ApiError(400, "One or more evidence files are unavailable or already attached");
    newlyClaimedFileIds = files.filter((file) => !file.contributionId).map((file) => String(file._id));
    if (newlyClaimedFileIds.length > 0) {
      const claimed = await UploadedFile.updateMany(
        { _id: { $in: newlyClaimedFileIds }, ownerId: userId, status: "quarantined", contributionId: null },
        { $set: { contributionId } }
      );
      if (claimed.modifiedCount !== newlyClaimedFileIds.length) {
        await UploadedFile.updateMany({ _id: { $in: newlyClaimedFileIds, contributionId }, contributionId }, { $set: { contributionId: null } });
        throw new ApiError(409, "Evidence files changed while the contribution was being resubmitted");
      }
    }
  }

  const previousStatus = contribution.status;
  const previousEvidence = contribution.evidenceFileIds.map(String);
  contribution.title = title;
  contribution.description = description;
  contribution.proposedChanges = normalized;
  contribution.evidenceFileIds = [...new Set([...previousEvidence, ...uniqueFileIds])];
  contribution.duplicateKey = key;
  contribution.status = "SUBMITTED";
  contribution.reason = "";
  contribution.reviewNotes = "";
  contribution.reviewedAt = null;
  contribution.reviewedBy = null;
  contribution.history.push({ action: "SUBMITTED", actorId: userId, notes: "Contribution resubmitted after requested changes", previousStatus, nextStatus: "SUBMITTED" });
  try {
    await contribution.save();
  } catch (error) {
    if (newlyClaimedFileIds.length > 0)
      await UploadedFile.updateMany({ _id: { $in: newlyClaimedFileIds }, contributionId }, { $set: { contributionId: null } });
    throw error;
  }
  return contribution;
}

async function reviewContribution(options) {
  const session = await mongoose.startSession();
  let result;
  try {
    try {
      await session.withTransaction(async () => {
        result = await reviewContributionInTransaction({ ...options, session });
      });
      return result;
    } catch (error) {
      if (!error || error.code !== 20 || !String(error.errmsg || "").includes("replica set")) {
        throw error;
      }
      result = await reviewContributionInTransaction({ ...options, session: null });
      return result;
    }
  } finally {
    await session.endSession();
  }
}

async function reviewContributionInTransaction({ contributionId, action, actorId, actorRole, campusIds = [], notes = "", session }) {
  const contribution = await Contribution.findById(contributionId).session(session);
  if (!contribution) throw new ApiError(404, "Contribution not found");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(contribution.status)) {
    throw new ApiError(409, "This contribution is not awaiting review");
  }
  if (String(contribution.submitterId) === actorId) throw new ApiError(403, "You cannot review your own contribution");
  if (actorRole === "campus_coordinator" && !campusIds.includes(contribution.campusId.toString())) {
    throw new ApiError(403, "Campus access denied");
  }

  if (action === "APPROVED") {
    await applyApprovedContribution(contribution, actorId, notes, session);
    return contribution;
  }
  if (action === "REJECTED") {
    const previousStatus = contribution.status;
    contribution.status = "REJECTED";
    contribution.reason = notes;
    contribution.reviewedBy = actorId;
    contribution.reviewedAt = new Date();
    contribution.reviewNotes = notes;
    contribution.history.push({ action: "REJECTED", actorId, notes, previousStatus, nextStatus: "REJECTED" });
    await contribution.save({ session });
    await UploadedFile.updateMany(
      { _id: { $in: contribution.evidenceFileIds } },
      { $set: { status: "rejected", reviewedBy: actorId, reviewedAt: contribution.reviewedAt } },
      { session }
    );
    return contribution;
  }
  if (action === "CHANGES_REQUESTED") {
    const previousStatus = contribution.status;
    contribution.status = "CHANGES_REQUESTED";
    contribution.reason = notes;
    contribution.reviewedBy = actorId;
    contribution.reviewedAt = new Date();
    contribution.reviewNotes = notes;
    contribution.history.push({ action: "CHANGES_REQUESTED", actorId, notes, previousStatus, nextStatus: "CHANGES_REQUESTED" });
    await contribution.save({ session });
    return contribution;
  }
  throw new ApiError(400, "Unsupported review action");
}

async function applyApprovedContribution(contribution, actorId, notes, session) {
  const previousStatus = contribution.status;
  const Model = MODEL_BY_NAME[contribution.targetModel];
  const target = await Model.findOne({ _id: contribution.targetId, campusId: contribution.campusId }).session(session);
  if (!target) throw new ApiError(404, "Target data no longer exists");

  const allowedFields = new Set(["name", "abbreviation", "type", "description", "latitude", "longitude", "floorNumber", "roomNumber", "capacity", "aliases", "isAccessible", "navigationNodeId"]);
  const safeChanges = Object.fromEntries(Object.entries(contribution.proposedChanges || {}).filter(([key]) => allowedFields.has(key)));
  if (Object.keys(safeChanges).length === 0) throw new ApiError(400, "No approved fields were provided");

  if (safeChanges.navigationNodeId != null) {
    const NavigationNode = require("../models/NavigationNode");
    const node = await NavigationNode.findOne({ _id: safeChanges.navigationNodeId, campusId: contribution.campusId }).session(session);
    if (!node) throw new ApiError(400, "Navigation node must belong to the contribution campus");
  }

  Object.assign(target, safeChanges);
  target.dataSource = "manual";
  target.verificationStatus = "needs_verification";
  target.verificationNotes = `Approved by ${actorId.toString()} on ${new Date().toISOString()}`;
  await target.save({ session });
  await markCampusDirty(contribution.campusId, session);

  const rewardConfig = await ContributionRewardConfig.findOne({ targetModel: contribution.targetModel, isActive: true }).sort({ points: -1 }).session(session);
  if (rewardConfig && rewardConfig.points > 0) {
    const alreadyGranted = await Contribution.findOne({ _id: { $ne: contribution._id }, submitterId: contribution.submitterId, targetModel: contribution.targetModel, targetId: contribution.targetId, rewardGrantedAt: { $ne: null } }).session(session);
    if (!alreadyGranted) {
      await User.updateOne({ _id: contribution.submitterId }, { $inc: { contributionPoints: rewardConfig.points } }, { session });
      contribution.rewardPoints = rewardConfig.points;
      contribution.rewardGrantedAt = new Date();
    }
  }

  contribution.status = "APPROVED";
  contribution.reviewedBy = actorId;
  contribution.reviewedAt = new Date();
  contribution.reviewNotes = notes;
  contribution.history.push({ action: "APPROVED", actorId, notes, previousStatus, nextStatus: "APPROVED" });
  await contribution.save({ session });
  await UploadedFile.updateMany(
    { _id: { $in: contribution.evidenceFileIds } },
    { $set: { status: "approved", reviewedBy: actorId, reviewedAt: contribution.reviewedAt } },
    { session }
  );
  return contribution;
}

async function listContributions({ user, query, status, campusId }) {
  const filter = {};
  if (user.role === "campus_coordinator") {
    const assignedCampusIds = (user.campusIds || []).map((id) => String(id));
    filter.campusId = {
      $in: (campusId ? assignedCampusIds.filter((id) => id === String(campusId)) : assignedCampusIds)
        .map((id) => new mongoose.Types.ObjectId(id)),
    };
  } else if (user.role !== "admin" && user.role !== "moderator") {
    filter.submitterId = user.id;
  }
  if (status) filter.status = status;
  if (campusId && user.role !== "campus_coordinator") filter.campusId = campusId;
  if (query) filter.$text = { $search: query };
  return Contribution.find(filter).sort({ createdAt: -1 }).limit(100).lean();
}

module.exports = {
  submitContribution,
  attachEvidence,
  resubmitContribution,
  reviewContribution,
  listContributions,
  applyApprovedContribution,
  canonicalChangeDigest,
};
