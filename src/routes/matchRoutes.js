const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const matchController = require("../controllers/matchController");

const router = express.Router();

router.use(authMiddleware);
router.post("/", matchController.createMatch);
router.get("/", matchController.getMatches);
router.get("/:matchId", matchController.getMatchById);
router.post("/:matchId/join", matchController.joinMatch);
router.patch("/:matchId/room-code", matchController.setRoomCode);
router.post("/:matchId/leave", matchController.leaveMatch);
router.post("/:matchId/cancel", matchController.cancelMatch);

module.exports = router;
