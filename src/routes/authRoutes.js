const express = require("express");
const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const {
  authenticationRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.post("/signup", authenticationRateLimiter, authController.signup);
router.post("/login", authenticationRateLimiter, authController.login);
router.get("/me", authMiddleware, authController.getCurrentUser);

module.exports = router;
