const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const adminMatchController = require("../controllers/adminMatchController");
const {
  financialWriteRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get("/pending", adminMatchController.getPendingMatches);
router.get("/disputed", adminMatchController.getDisputedMatches);
router.get("/:matchId", adminMatchController.getMatch);
router.post(
  "/:matchId/declare-winner",
  financialWriteRateLimiter,
  adminMatchController.declareWinner
);
router.post(
  "/:matchId/refund",
  financialWriteRateLimiter,
  adminMatchController.refundMatch
);
router.post(
  "/:matchId/reject-claim",
  financialWriteRateLimiter,
  adminMatchController.rejectClaim
);

module.exports = router;
