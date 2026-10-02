const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const adminDepositController = require("../controllers/adminDepositController");
const {
  financialWriteRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get("/deposits/pending", adminDepositController.getPendingDeposits);
router.get("/deposits", adminDepositController.getAdminDeposits);
router.get(
  "/deposits/:transactionId",
  adminDepositController.getDepositDetail
);
router.post(
  "/deposits/:transactionId/approve",
  financialWriteRateLimiter,
  adminDepositController.approveDeposit
);
router.post(
  "/deposits/:transactionId/reject",
  financialWriteRateLimiter,
  adminDepositController.rejectDeposit
);

module.exports = router;
