const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { financialWriteRateLimiter } = require("../middleware/securityMiddleware");
const paymentController = require("../controllers/razorpayOrderController");

const router = express.Router();
router.post("/order", authMiddleware, (request, response, next) => {
  request.user.userId = request.user.id;
  next();
}, financialWriteRateLimiter, paymentController.createOrder);

module.exports = router;
