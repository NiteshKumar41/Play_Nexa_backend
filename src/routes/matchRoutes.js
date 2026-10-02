const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const matchController = require("../controllers/matchController");
const {
  financialWriteRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.use(authMiddleware);
router.post("/", financialWriteRateLimiter, matchController.createMatch);
router.get("/", matchController.getMatches);
router.get("/:matchId", matchController.getMatchById);
router.post(
  "/:matchId/join",
  financialWriteRateLimiter,
  matchController.joinMatch
);
router.patch(
  "/:matchId/room-code",
  financialWriteRateLimiter,
  matchController.setRoomCode
);
router.post(
  "/:matchId/leave",
  financialWriteRateLimiter,
  matchController.leaveMatch
);
router.post(
  "/:matchId/cancel",
  financialWriteRateLimiter,
  matchController.cancelMatch
);

module.exports = router;
