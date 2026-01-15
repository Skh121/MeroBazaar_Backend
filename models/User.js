const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const addressSchema = new mongoose.Schema({
  label: {
    type: String,
    enum: ["Home", "Work", "Other"],
    default: "Home",
  },
  street: String,
  city: String,
  district: String,
  province: String,
  isDefault: {
    type: Boolean,
    default: false,
  },
});

const UserSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: false,
    default: null,
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
    // No default - field should not exist for non-Google users
  },
  authProvider: {
    type: String,
    enum: ["local", "google"],
    default: "local",
  },
  phone: {
    type: String,
    default: "",
  },
  dateOfBirth: {
    type: Date,
    default: null,
  },
  gender: {
    type: String,
    enum: ["male", "female", "other", "prefer_not_to_say", ""],
    default: "",
  },
  avatar: {
    type: String,
    default: "",
  },
  addresses: [addressSchema],
  role: {
    type: String,
    enum: ["customer", "admin"],
    default: "customer",
  },
  status: {
    type: String,
    enum: ["active", "suspended"],
    default: "active",
  },
  suspendedAt: {
    type: Date,
    default: null,
  },
  suspendReason: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  otp: {
    type: String,
    default: null,
  },
  otpExpiry: {
    type: Date,
    default: null,
  },
});

// Method to compare entered password with hashed password in DB
UserSchema.methods.matchPassword = async function (enteredPassword) {
  // Return false if no password set (Google-only users)
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

// Middleware: Hash password before saving (runs on signup)
UserSchema.pre("save", async function () {
  // Skip if password is null/undefined or not modified
  if (!this.password || !this.isModified("password")) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model("User", UserSchema);

module.exports = User;
