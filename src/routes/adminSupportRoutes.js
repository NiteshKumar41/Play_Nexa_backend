const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const adminSupportController = require("../controllers/adminSupportController");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get("/tickets", adminSupportController.getTickets);
router.get("/tickets/:ticketId", adminSupportController.getTicket);
router.patch(
  "/tickets/:ticketId/status",
  adminSupportController.updateStatus
);
router.post(
  "/tickets/:ticketId/resolve",
  adminSupportController.resolveTicket
);
router.post("/tickets/:ticketId/close", adminSupportController.closeTicket);
router.post(
  "/tickets/:ticketId/reopen",
  adminSupportController.reopenTicket
);
router.patch(
  "/tickets/:ticketId/assign",
  adminSupportController.assignTicket
);

module.exports = router;
