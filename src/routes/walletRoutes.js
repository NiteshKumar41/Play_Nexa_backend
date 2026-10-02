const express = require("express");
const walletController = require("../controllers/walletController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);
router.get("/", walletController.getWallet);
router.get("/transactions", walletController.getTransactions);

module.exports = router;
