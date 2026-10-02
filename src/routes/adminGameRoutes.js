const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const uploadImage = require("../middleware/uploadMiddleware");
const adminGameController = require("../controllers/adminGameController");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get("/", adminGameController.getGames);
router.get("/:gameId", adminGameController.getGame);
router.post("/", uploadImage.single("image"), adminGameController.createGame);
router.patch(
  "/:gameId",
  uploadImage.single("image"),
  adminGameController.updateGame
);
router.delete("/:gameId", adminGameController.deleteGame);

module.exports = router;
