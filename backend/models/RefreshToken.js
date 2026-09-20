const mongoose = require("mongoose");

/**
 * One row per issued refresh token. Only a SHA-256 hash of the token is stored
 * (like a password, a DB leak must not hand out usable sessions). Tokens are
 * single-use: /auth/refresh revokes the presented token and issues a new one
 * (rotation), so a stolen-then-used token stops working for the real client
 * the next time it refreshes.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

// MongoDB deletes the document itself once expiresAt has passed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
