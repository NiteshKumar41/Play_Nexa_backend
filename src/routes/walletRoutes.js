const express = require("express");
const walletController = require("../controllers/walletController");
const depositController = require("../controllers/depositController");
const authMiddleware = require("../middleware/authMiddleware");
const uploadImage = require("../middleware/uploadMiddleware");
const {
  financialWriteRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.use(authMiddleware);
router.get("/", walletController.getWallet);
router.get("/transactions", walletController.getTransactions);
router.post(
  "/deposits",
  financialWriteRateLimiter,
  uploadImage.single("proof"),
  depositController.createDeposit
);
router.get("/deposits", depositController.getUserDeposits);
router.get(
  "/deposits/:transactionId/proof/:fileName",
  depositController.getDepositProof
);

module.exports = router;
