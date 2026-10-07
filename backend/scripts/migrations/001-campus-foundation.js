/**
 * 001 — campus foundation. Additive and idempotent; no legacy data is deleted or reshaped.
 *
 *  - University: fills `abbreviation` from legacy `ShortName`; marks existing rows dataSource "legacy".
 *  - Campus / NavigationNode / NavigationEdge / Location: marks pre-existing rows dataSource "legacy"
 *    (rows already carrying a dataSource are left alone, so DEV_FIXTURE is never relabelled).
 *    Geofence stays UNCONFIGURED — an existing campus's boundary is never guessed.
 *  - Campus.pack counters are initialised (version 0, unpublished).
 *  - Location.searchKeys is built from name + aliases.
 *  - Creates indexes for the new collections.
 */
const University = require("../../models/University");
const Campus = require("../../models/Campus");
const Location = require("../../models/Location");
const NavigationNode = require("../../models/NavigationNode");
const NavigationEdge = require("../../models/NavigationEdge");
const Building = require("../../models/Building");
const Floor = require("../../models/Floor");
const Room = require("../../models/Room");
const Entrance = require("../../models/Entrance");
const Landmark = require("../../models/Landmark");
const CampusPack = require("../../models/CampusPack");
const UploadedFile = require("../../models/UploadedFile");
const { reindexSearchKeys } = require("../reindexSearchKeys");

module.exports = {
  name: "001-campus-foundation",

  async up({ dryRun }) {
    const summary = {};
    const unmarked = { dataSource: { $exists: false } };

    // Documents written before this migration have no dataSource field at all.
    for (const Model of [University, Campus, NavigationNode, NavigationEdge, Location]) {
      const count = await Model.countDocuments(unmarked);
      summary[`${Model.modelName}_markLegacy`] = count;
      if (!dryRun && count) await Model.updateMany(unmarked, { $set: { dataSource: "legacy", verificationStatus: "unverified" } });
    }

    const needAbbreviation = await University.find({ $or: [{ abbreviation: { $exists: false } }, { abbreviation: "" }], ShortName: { $exists: true } }).select("_id ShortName").lean();
    summary["University_abbreviation"] = needAbbreviation.length;
    if (!dryRun) {
      for (const u of needAbbreviation) await University.updateOne({ _id: u._id }, { $set: { abbreviation: u.ShortName } });
    }

    const needPack = await Campus.countDocuments({ pack: { $exists: false } });
    summary["Campus_packInit"] = needPack;
    if (!dryRun && needPack) {
      await Campus.updateMany({ pack: { $exists: false } }, { $set: { pack: { currentVersion: 0, hasUnpublishedChanges: true, lastPublishedAt: null } } });
    }

    if (!dryRun) {
      summary.searchKeysUpdated = await reindexSearchKeys();
      for (const Model of [Building, Floor, Room, Entrance, Landmark, CampusPack, UploadedFile, Location, Campus, University, NavigationNode, NavigationEdge]) {
        await Model.createIndexes();
      }
    }
    return summary;
  },
};
