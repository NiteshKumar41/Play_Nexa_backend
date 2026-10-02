const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const uploadImage = require("../middleware/uploadMiddleware");
const supportController = require("../controllers/supportController");
const {
  financialWriteRateLimiter,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.use(authMiddleware);
router.post(
  "/tickets",
  financialWriteRateLimiter,
  uploadImage.single("image"),
  supportController.createTicket
);
router.get("/tickets", supportController.getMyTickets);
router.get(
  "/tickets/:ticketId/image/:fileName",
  supportController.getTicketImage
);
router.get("/tickets/:ticketId", supportController.getMyTicket);

module.exports = router;
