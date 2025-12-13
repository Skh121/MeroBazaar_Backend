const express = require("express");
const {
  registerUser,
  authUser,
  forgotPassword,
  verifyOTP,
  resetPassword,
} = require("../controllers/authController");
const validate = require("../middleware/validate");
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyOTPSchema,
  resetPasswordSchema,
} = require("../validators/authValidators");
const router = express.Router();

// Public routes for authentication
router.post("/signup", validate(registerSchema), registerUser);
router.post("/login", validate(loginSchema), authUser);

// Forgot password routes
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);
router.post("/verify-otp", validate(verifyOTPSchema), verifyOTP);
router.post("/reset-password", validate(resetPasswordSchema), resetPassword);

module.exports = router;
