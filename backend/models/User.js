const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// One role system for everyone (no separate admin login). Authorization is always
// enforced server-side with requireRole(...) — see middleware/auth.js.
//   moderator           reviews community contributions (later phases); no campus-data writes
//   campus_coordinator  edits campus data (buildings, rooms, paths) and publishes campus packs
const ROLES = ["user", "business", "admin", "moderator", "campus_coordinator"];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    // select:false so a normal `find()`/`findById()` never accidentally leaks
    // the hash; controllers must explicitly `.select("+passwordHash")`.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "user" },
    // Campuses a campus_coordinator may edit. Meaningless for other roles (admin is global,
    // everyone else has no campus-write access). Default is EMPTY = no access (deny by default).
    // Only an admin can change this (PATCH /api/v1/admin/users/:id/campuses); it can never be
    // set through registration or profile endpoints.
    campusIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Campus" }],
    phone: { type: String, default: "" },
    isVerified: { type: Boolean, default: false },
    contributionPoints: { type: Number, min: 0, default: 0 },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);


/**
 * Set on a plain-text password; hashes it into passwordHash.
 * Kept on the model (not a route) so any future code path that creates a
 * user — auth routes, an admin script, a seed script — hashes consistently.
 * Usage: user.setPassword(plainTextPassword); await user.save();
 */
userSchema.methods.setPassword = async function (plainTextPassword) {
  const saltRounds = 10;
  this.passwordHash = await bcrypt.hash(plainTextPassword, saltRounds);
};

userSchema.methods.comparePassword = function (plainTextPassword) {
  return bcrypt.compare(plainTextPassword, this.passwordHash);
};

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model("User", userSchema);
