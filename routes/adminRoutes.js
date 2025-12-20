const express = require("express");
const {
  getAllVendors,
  getPendingVendors,
  getVendorById,
  approveVendor,
  rejectVendor,
  suspendVendor,
  reactivateVendor,
  getVendorStats,
} = require("../controllers/adminController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// All admin routes require authentication and admin role
router.use(protect);
router.use(adminOnly);

// Vendor management routes
router.get("/vendors", getAllVendors);
router.get("/vendors/pending", getPendingVendors);
router.get("/vendors/stats", getVendorStats);
router.get("/vendors/:id", getVendorById);
router.patch("/vendors/:id/approve", approveVendor);
router.patch("/vendors/:id/reject", rejectVendor);
router.patch("/vendors/:id/suspend", suspendVendor);
router.patch("/vendors/:id/reactivate", reactivateVendor);

module.exports = router;
