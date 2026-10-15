const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const profileController = require("../controllers/profileController");

const router = express.Router();

router.use(authMiddleware);
router.get("/me", profileController.getMe);
router.patch("/me", profileController.updateMe);

module.exports = router;
