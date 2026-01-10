const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const {
  sendOTPEmail,
  sendNewCustomerNotification,
} = require("../services/emailService");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
    // Send notification to admin about new customer registration
    sendNewCustomerNotification(user);

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

  if (!user) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  // Check if this is a Google-only user (no password set)
  if (user.authProvider === "google" && !user.password) {
    res.status(401).json({
      message:
        "This account uses Google Sign-In. Please use the Google button to log in.",
      authProvider: "google",
    });
    return;
  }

  // Check if the provided password matches the stored hash
  if (await user.matchPassword(password)) {
    res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      authProvider: user.authProvider,
      token: generateToken(user._id),
    });
  } else {
    res.status(401).json({ message: "Invalid email or password." });
  }
});

// @desc    Authenticate with Google OAuth
// @route   POST /api/auth/google
// @access  Public
const googleAuth = asyncHandler(async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    res.status(400).json({ message: "Google credential is required." });
    return;
  }

  // Verify the Google ID token
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    res.status(401).json({ message: "Invalid Google token." });
    return;
  }

  const { sub: googleId, email, name, picture } = payload;

  // Check if user exists by googleId (returning Google user)
  let user = await User.findOne({ googleId });

  if (user) {
    // Returning Google user - just log them in
    return res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      authProvider: user.authProvider,
      token: generateToken(user._id),
    });
  }

  // Check if user exists by email (account linking scenario)
  user = await User.findOne({ email });

  if (user) {
    // Account linking: Email exists, link Google account
    user.googleId = googleId;
    user.avatar = user.avatar || picture;
    await user.save({ validateBeforeSave: false });

    return res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      authProvider: user.authProvider,
      isLinked: true,
      token: generateToken(user._id),
    });
  }

  // New user - create account via Google
  user = await User.create({
    googleId,
    fullName: name,
    email,
    password: null,
    authProvider: "google",
    avatar: picture,
    role: "customer",
  });

  // Send notification to admin about new customer registration
  sendNewCustomerNotification(user);

  res.status(201).json({
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    authProvider: user.authProvider,
    isNewUser: true,
    token: generateToken(user._id),
  });
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
  googleAuth,
  forgotPassword,
  verifyOTP,
  resetPassword,
};
