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
    required: true,
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
  // 'this.password' is the hashed password from the DB
  return await bcrypt.compare(enteredPassword, this.password);
};

// Middleware: Hash password before saving (runs on signup)
// FIX: Removed 'next' argument and the 'next()' call for an async hook.
UserSchema.pre("save", async function () {
  // Only run if the password field is actually modified
  if (!this.isModified("password")) {
    return; // Use 'return' instead of 'return next()'
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  // Mongoose automatically continues when this async function completes.
});

const User = mongoose.model("User", UserSchema);

module.exports = User;
