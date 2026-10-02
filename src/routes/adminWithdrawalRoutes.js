const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const adminWithdrawalController = require("../controllers/adminWithdrawalController");
const {
  financialWriteRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get("/pending", adminWithdrawalController.getPendingWithdrawals);
router.get("/", adminWithdrawalController.getAdminWithdrawals);
router.get("/:transactionId", adminWithdrawalController.getWithdrawalDetail);
router.post(
  "/:transactionId/success",
  financialWriteRateLimiter,
  adminWithdrawalController.markWithdrawalSuccess
);
router.post(
  "/:transactionId/reject",
  financialWriteRateLimiter,
  adminWithdrawalController.rejectWithdrawal
);

module.exports = router;
