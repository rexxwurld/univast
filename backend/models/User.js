const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROLES = ["user", "business", "admin"];

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
    phone: { type: String, default: "" },
    isVerified: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });

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
