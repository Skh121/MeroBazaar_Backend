const asyncHandler = require("express-async-handler");
const Settings = require("../models/Settings");
const {
  sendDailyReport,
  sendWeeklyReport,
} = require("../services/reportService");

// @desc    Get admin settings
// @route   GET /api/settings
// @access  Private (Admin)
const getSettings = asyncHandler(async (req, res) => {
  let settings = await Settings.findOne({ key: "admin_settings" });

  // If no settings exist, create default settings
  if (!settings) {
    settings = await Settings.create({
      key: "admin_settings",
      adminEmail: req.user.email,
    });
  }

  res.json(settings);
});

// @desc    Update notification settings
// @route   PUT /api/settings/notifications
// @access  Private (Admin)
const updateNotificationSettings = asyncHandler(async (req, res) => {
  const {
    emailOnNewOrder,
    emailOnNewVendor,
    emailOnNewCustomer,
    emailOnLowStock,
    emailOnContactMessage,
    dailyReport,
    weeklyReport,
    adminEmail,
  } = req.body;

  let settings = await Settings.findOne({ key: "admin_settings" });

  if (!settings) {
    settings = new Settings({ key: "admin_settings" });
  }

  // Update notification preferences
  settings.notifications = {
    emailOnNewOrder: emailOnNewOrder ?? settings.notifications.emailOnNewOrder,
    emailOnNewVendor:
      emailOnNewVendor ?? settings.notifications.emailOnNewVendor,
    emailOnNewCustomer:
      emailOnNewCustomer ?? settings.notifications.emailOnNewCustomer,
    emailOnLowStock: emailOnLowStock ?? settings.notifications.emailOnLowStock,
    emailOnContactMessage:
      emailOnContactMessage ?? settings.notifications.emailOnContactMessage,
    dailyReport: dailyReport ?? settings.notifications.dailyReport,
    weeklyReport: weeklyReport ?? settings.notifications.weeklyReport,
  };

  if (adminEmail !== undefined) {
    settings.adminEmail = adminEmail;
  }

  await settings.save();

  res.json({
    message: "Notification settings updated successfully",
    settings,
  });
});

// @desc    Trigger daily report manually
// @route   POST /api/settings/reports/daily
// @access  Private (Admin)
const triggerDailyReport = asyncHandler(async (req, res) => {
  await sendDailyReport();
  res.json({ message: "Daily report triggered successfully" });
});

// @desc    Trigger weekly report manually
// @route   POST /api/settings/reports/weekly
// @access  Private (Admin)
const triggerWeeklyReport = asyncHandler(async (req, res) => {
  await sendWeeklyReport();
  res.json({ message: "Weekly report triggered successfully" });
});

module.exports = {
  getSettings,
  updateNotificationSettings,
  triggerDailyReport,
  triggerWeeklyReport,
};
