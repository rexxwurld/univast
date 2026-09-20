const crypto = require("crypto");
const jwt = require("jsonwebtoken");

// Access tokens are short-lived; the long-lived credential is the refresh
// token (see models/RefreshToken.js). Override with JWT_EXPIRES_IN.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS) || 30;

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/** SHA-256 hex digest — how refresh tokens are stored and looked up. */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** A fresh opaque refresh token (not a JWT) plus its hash and expiry date. */
function generateRefreshToken() {
  const token = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  return { token, tokenHash: hashToken(token), expiresAt };
}

module.exports = { signToken, verifyToken, hashToken, generateRefreshToken };
