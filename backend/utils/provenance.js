/**
 * Provenance fields shared by every campus-data model.
 *
 * Why: UNIVAST must never present placeholder or unverified data as fact.
 *   dataSource          where the record came from. "DEV_FIXTURE" marks synthetic
 *                       development data that must be removed before real data is
 *                       published (see seeds/devFixture.js -> removeDevFixture()).
 *   verificationStatus  whether a human has confirmed the record against a source.
 *                       Importers must use "needs_verification" for anything they
 *                       could not read unambiguously — never guess.
 */
const DATA_SOURCES = ["manual", "legacy", "import", "DEV_FIXTURE"];
const VERIFICATION_STATUSES = ["unverified", "verified", "needs_verification"];

const provenanceFields = {
  dataSource: { type: String, enum: DATA_SOURCES, default: "manual" },
  verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: "unverified" },
  verificationNotes: { type: String, default: "", maxlength: 1000 },
};

module.exports = { DATA_SOURCES, VERIFICATION_STATUSES, provenanceFields };
