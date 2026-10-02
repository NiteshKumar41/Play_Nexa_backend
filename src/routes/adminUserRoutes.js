const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const adminUserController = require("../controllers/adminUserController");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.get("/", adminUserController.getUsers);
router.get("/:userId", adminUserController.getUser);
router.patch("/:userId/status", adminUserController.updateStatus);
router.patch("/:userId/block", adminUserController.updateBlock);
router.patch("/:userId/role", adminUserController.updateRole);

module.exports = router;
