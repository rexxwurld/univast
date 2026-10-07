const mongoose = require("mongoose");
const { provenanceFields } = require("../utils/provenance");

const universitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ShortName: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    // Added for the campus platform. `ShortName` stays (legacy, required); abbreviation
    // mirrors it when not given so new code can use the spec'd field name.
    abbreviation: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    ...provenanceFields,
  },
  { timestamps: true }
);

universitySchema.pre("validate", async function fillAbbreviation() {
  if (!this.abbreviation && this.ShortName) this.abbreviation = this.ShortName;
});

universitySchema.index({ name: 1 });
universitySchema.index({ ShortName: 1 });

universitySchema.plugin(require("./plugins/searchIndexInvalidation"));

module.exports = mongoose.model("University", universitySchema);
