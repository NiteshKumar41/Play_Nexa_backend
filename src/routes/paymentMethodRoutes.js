const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const paymentMethodController = require("../controllers/paymentMethodController");

const router = express.Router();

router.use(authMiddleware);
router.get("/active", paymentMethodController.getActivePaymentMethod);
router.get(
  "/:paymentMethodId/qr/:fileName",
  paymentMethodController.getPaymentMethodQr
);

module.exports = router;
