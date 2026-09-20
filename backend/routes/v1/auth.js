const express = require("express");
const router = express.Router();

const authController = require("../../controllers/authController");
const { requireAuth } = require("../../middleware/auth");
const { authLimiter, refreshLimiter } = require("../../middleware/rateLimit");
const { validateBody } = require("../../middleware/validateSchema");
const { registerSchema, loginSchema, refreshTokenSchema } = require("../../validators/schemas");

router.post("/register", authLimiter, validateBody(registerSchema), authController.register);
router.post("/login", authLimiter, validateBody(loginSchema), authController.login);
router.post("/refresh", refreshLimiter, validateBody(refreshTokenSchema), authController.refresh);
router.post("/logout", refreshLimiter, validateBody(refreshTokenSchema), authController.logout);
router.post("/logout-all", requireAuth, authController.logoutAll);
router.get("/me", requireAuth, authController.me);

module.exports = router;
