const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const uploadScreenshot = require("../middleware/uploadMiddleware");
const resultController = require("../controllers/resultController");

const router = express.Router();

router.post(
  "/:matchId/result",
  authMiddleware,
  uploadScreenshot.single("screenshot"),
  resultController.submitWinnerClaim
);
router.post(
  "/:matchId/dispute",
  authMiddleware,
  uploadScreenshot.single("screenshot"),
  resultController.submitDispute
);
router.get(
  "/admin/results",
  authMiddleware,
  adminMiddleware,
  resultController.getPendingResults
);
router.get(
  "/:matchId/result/evidence/:fileName",
  authMiddleware,
  resultController.getEvidenceFile
);
router.get(
  "/:matchId/result",
  authMiddleware,
  resultController.getResultByMatchId
);

module.exports = router;
