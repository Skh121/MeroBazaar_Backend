const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendOTPEmail } = require("../services/emailService");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, password } = req.body;

  const userExists = await User.findOne({ email });

  if (userExists) {
    res
      .status(400)
      .json({ message: "User already exists with this email address." });
    return;
  }

  const user = await User.create({
    fullName,
    email,
    password,
  });

  if (user) {
    res.status(201).json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role, // Will be 'customer'
      token: generateToken(user._id),
    });
  } else {
    res.status(400).json({ message: "Invalid user data provided." });
  }
});

// @desc    Authenticate user (Customer or Admin) & get token
// @route   POST /api/auth/login
// @access  Public
const authUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  // Check if user exists AND if the provided password matches the stored hash
  if (user && (await user.matchPassword(password))) {
    res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role, // <-- CRUCIAL: Returns 'customer' or 'admin'
      token: generateToken(user._id),
    });
  } else {
    // 401 Unauthorized
    res.status(401).json({ message: "Invalid email or password." });
  }
});

// @desc    Request password reset OTP
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    res.status(404).json({ message: "No account found with this email." });
    return;
  }

  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();

  // Set OTP and expiry (10 minutes)
  user.otp = otp;
  user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  try {
    await sendOTPEmail(email, otp);
    res.json({ message: "OTP sent to your email address." });
  } catch (error) {
    user.otp = null;
    user.otpExpiry = null;
    await user.save({ validateBeforeSave: false });
    res
      .status(500)
      .json({ message: "Failed to send email. Please try again." });
  }
});

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    res.status(404).json({ message: "No account found with this email." });
    return;
  }

  if (!user.otp || !user.otpExpiry) {
    res
      .status(400)
      .json({ message: "No OTP request found. Please request a new OTP." });
    return;
  }

  if (new Date() > user.otpExpiry) {
    user.otp = null;
    user.otpExpiry = null;
    await user.save({ validateBeforeSave: false });
    res
      .status(400)
      .json({ message: "OTP has expired. Please request a new one." });
    return;
  }

  if (user.otp !== otp) {
    res.status(400).json({ message: "Invalid OTP." });
    return;
  }

  res.json({
    message: "OTP verified successfully. You can now reset your password.",
  });
});

// @desc    Reset password after OTP verification
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    res.status(404).json({ message: "No account found with this email." });
    return;
  }

  if (!user.otp || !user.otpExpiry) {
    res
      .status(400)
      .json({ message: "No OTP request found. Please request a new OTP." });
    return;
  }

  if (new Date() > user.otpExpiry) {
    user.otp = null;
    user.otpExpiry = null;
    await user.save({ validateBeforeSave: false });
    res
      .status(400)
      .json({ message: "OTP has expired. Please request a new one." });
    return;
  }

  if (user.otp !== otp) {
    res.status(400).json({ message: "Invalid OTP." });
    return;
  }

  // Update password and clear OTP
  user.password = newPassword;
  user.otp = null;
  user.otpExpiry = null;
  await user.save();

  res.json({
    message:
      "Password reset successfully. You can now login with your new password.",
  });
});

module.exports = {
  registerUser,
  authUser,
  forgotPassword,
  verifyOTP,
  resetPassword,
};
