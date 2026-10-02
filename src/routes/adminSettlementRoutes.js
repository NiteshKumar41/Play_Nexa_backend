const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const adminSettlementController = require("../controllers/adminSettlementController");
const {
  financialWriteRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get( "/matches/pending-settlement",
  adminSettlementController.getPendingSettlementQueue
);
router.get("/matches/settled", adminSettlementController.getSettlementHistory);
router.get(
  "/matches/:matchId/settlement",
  adminSettlementController.getSettlementDetail
);
router.post(
  "/matches/:matchId/settle",
  financialWriteRateLimiter,
  adminSettlementController.settleMatch
);

module.exports = router;
