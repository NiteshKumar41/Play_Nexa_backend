const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const withdrawalController = require("../controllers/withdrawalController");
const {
  financialWriteRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.use(authMiddleware);
router.post("/", financialWriteRateLimiter, withdrawalController.createWithdrawal);
router.get("/", withdrawalController.getUserWithdrawals);

module.exports = router;
