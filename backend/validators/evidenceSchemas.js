const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "must be a valid id");

const attachEvidence = z.object({
  fileIds: z.array(objectId).max(20).min(1),
});

module.exports = { attachEvidence };
