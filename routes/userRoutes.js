const express = require("express");
const {
  getUserProfile,
  updateUserProfile,
  changePassword,
  addAddress,
  updateAddress,
  deleteAddress,
  getAddresses,
} = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Profile routes
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateUserProfile);

// Password change
router.put("/change-password", protect, changePassword);

// Address routes
router.get("/addresses", protect, getAddresses);
router.post("/addresses", protect, addAddress);
router.put("/addresses/:addressId", protect, updateAddress);
router.delete("/addresses/:addressId", protect, deleteAddress);

module.exports = router;
