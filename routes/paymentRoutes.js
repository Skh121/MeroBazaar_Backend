const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  initiateEsewaPayment,
  verifyEsewaPayment,
  handleEsewaFailure,
  getPaymentStatus,
} = require("../controllers/paymentController");

// eSewa payment routes
router.post("/esewa/initiate", protect, initiateEsewaPayment);
router.post("/esewa/verify", protect, verifyEsewaPayment);
router.post("/esewa/failure", protect, handleEsewaFailure);

// Payment status
router.get("/status/:orderId", protect, getPaymentStatus);

module.exports = router;
