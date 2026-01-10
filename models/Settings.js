const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema({
  // There should only be one settings document
  key: {
    type: String,
    default: "admin_settings",
    unique: true,
  },

  // Notification preferences
  notifications: {
    emailOnNewOrder: {
      type: Boolean,
      default: true,
    },
    emailOnNewVendor: {
      type: Boolean,
      default: true,
    },
    emailOnNewCustomer: {
      type: Boolean,
      default: false,
    },
    emailOnLowStock: {
      type: Boolean,
      default: true,
    },
    emailOnContactMessage: {
      type: Boolean,
      default: true,
    },
    dailyReport: {
      type: Boolean,
      default: false,
    },
    weeklyReport: {
      type: Boolean,
      default: true,
    },
  },

  // Admin email to receive notifications
  adminEmail: {
    type: String,
    default: "",
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt timestamp before saving
SettingsSchema.pre("save", function () {
  this.updatedAt = new Date();
});

const Settings = mongoose.model("Settings", SettingsSchema);

module.exports = Settings;
