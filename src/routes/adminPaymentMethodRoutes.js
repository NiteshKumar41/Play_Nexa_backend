const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const uploadImage = require("../middleware/uploadMiddleware");
const paymentMethodController = require("../controllers/paymentMethodController");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get("/", paymentMethodController.getPaymentMethods);
router.post("/", uploadImage.single("qrImage"), paymentMethodController.createPaymentMethod);
router.patch(
  "/:paymentMethodId",
  uploadImage.single("qrImage"),
  paymentMethodController.updatePaymentMethod
);
router.patch(
  "/:paymentMethodId/activate",
  paymentMethodController.activatePaymentMethod
);
router.delete("/:paymentMethodId", paymentMethodController.deletePaymentMethod);

module.exports = router;
