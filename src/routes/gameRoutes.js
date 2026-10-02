const express = require("express");
const gameController = require("../controllers/gameController");
const adminMiddleware = require("../middleware/adminMiddleware");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

function optionalAuthMiddleware(request, response, next) {
  if (!request.headers.authorization) {
    return next();
  }

  return authMiddleware(request, response, next);
}

router.get("/", gameController.getGames);
router.get(
  "/image/:fileName",
  optionalAuthMiddleware,
  gameController.getGameImage
);
router.get(
  "/admin",
  authMiddleware,
  adminMiddleware,
  gameController.getAdminGames
);
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  gameController.createGame
);
router.put(
  "/:id",
  authMiddleware,
  adminMiddleware,
  gameController.updateGame
);
router.patch(
  "/:id/status",
  authMiddleware,
  adminMiddleware,
  gameController.toggleGameStatus
);
router.patch(
  "/:id/open-status",
  authMiddleware,
  adminMiddleware,
  gameController.toggleGameOpenStatus
);
router.delete(
  "/:id",
  authMiddleware,
  adminMiddleware,
  gameController.deleteGame
);
router.get("/:id", optionalAuthMiddleware, gameController.getGameById);

module.exports = router;
