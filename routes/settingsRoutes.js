const express = require("express");
const {
  getSettings,
  updateNotificationSettings,
  triggerDailyReport,
  triggerWeeklyReport,
} = require("../controllers/settingsController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// All settings routes require authentication and admin role
router.use(protect);
router.use(adminOnly);

router.get("/", getSettings);
router.put("/notifications", updateNotificationSettings);

// Manual report triggers (for testing)
router.post("/reports/daily", triggerDailyReport);
router.post("/reports/weekly", triggerWeeklyReport);

module.exports = router;
