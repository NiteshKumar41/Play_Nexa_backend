const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const adminDashboardController = require("../controllers/adminDashboardController");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get("/summary", adminDashboardController.getSummary);

module.exports = router;
