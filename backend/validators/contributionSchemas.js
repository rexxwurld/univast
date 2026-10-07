const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "must be a valid id");
const contributionTargetModel = z.enum(["Building", "Floor", "Room", "Entrance", "Landmark"]);
const submission = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().default(""),
  campusId: objectId,
  targetModel: contributionTargetModel,
  targetId: objectId,
  proposedChanges: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, "proposedChanges is required"),
  evidenceFileIds: z.array(objectId).max(20).optional().default([]),
});

const reviewAction = z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]);
const review = z.object({
  action: reviewAction,
  notes: z.string().trim().max(5000).optional().default(""),
});

const resubmission = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().default(""),
  targetModel: contributionTargetModel,
  targetId: objectId,
  proposedChanges: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, "proposedChanges is required"),
  evidenceFileIds: z.array(objectId).max(20).optional().default([]),
});

module.exports = { submission, resubmission, review };
