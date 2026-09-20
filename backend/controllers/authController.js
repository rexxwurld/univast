const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { signToken, hashToken, generateRefreshToken } = require("../utils/jwt");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role };
}

/**
 * Issues a short-lived access token (`token`, kept under that name so existing
 * clients keep working) plus a rotating refresh token.
 */
async function issueTokens(user, req) {
  const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken();
  await RefreshToken.create({
    user: user._id,
    tokenHash,
    expiresAt,
    userAgent: (req.get("user-agent") || "").slice(0, 200),
  });
  return { token: signToken(user), refreshToken };
}

const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!EMAIL_REGEX.test(email)) {
    throw new ApiError(400, "A valid email is required");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new ApiError(400, "An account with this email already exists");
  }

  const user = new User({ name, email: email.toLowerCase() });
  await user.setPassword(password);
  await user.save();

  const tokens = await issueTokens(user, req);
  res.status(201).json({ ...tokens, user: publicUser(user) });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "email and password are required");
  }

  // Same generic error for "no such user" and "wrong password" — don't leak
  // which one it was, that's a user-enumeration vector.
  const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const matches = await user.comparePassword(password);
  if (!matches) {
    throw new ApiError(401, "Invalid email or password");
  }

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokens(user, req);
  res.status(200).json({ ...tokens, user: publicUser(user) });
});

/**
 * POST /api/v1/auth/refresh { refreshToken } — exchanges a valid refresh token
 * for a new access token AND a new refresh token; the presented one is revoked
 * (rotation), so each refresh token works exactly once.
 */
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const stored = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) });
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  // Atomically claim the token: if two requests race with the same token,
  // only one of them flips revokedAt from null and wins.
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: stored._id, revokedAt: null },
    { revokedAt: new Date() }
  );
  if (!claimed) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await User.findById(stored.user);
  if (!user) {
    throw new ApiError(401, "User no longer exists");
  }

  const tokens = await issueTokens(user, req);
  res.status(200).json({ ...tokens, user: publicUser(user) });
});

/** POST /api/v1/auth/logout { refreshToken } — revokes this device's session. */
const logout = asyncHandler(async (req, res) => {
  await RefreshToken.updateOne(
    { tokenHash: hashToken(req.body.refreshToken), revokedAt: null },
    { revokedAt: new Date() }
  );
  res.status(204).send();
});

/** POST /api/v1/auth/logout-all (auth required) — revokes every session for this user. */
const logoutAll = asyncHandler(async (req, res) => {
  await RefreshToken.updateMany({ user: req.user.id, revokedAt: null }, { revokedAt: new Date() });
  res.status(204).send();
});

const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new ApiError(404, "User not found");
  res.status(200).json({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isVerified: user.isVerified,
  });
});

module.exports = { register, login, refresh, logout, logoutAll, me };
