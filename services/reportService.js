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
  getPlatformDashboardStats,
  getAllCustomers,
  getCustomerById,
  suspendCustomer,
  reactivateCustomer,
  deleteCustomer,
} = require("../controllers/adminController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// All admin routes require authentication and admin role
router.use(protect);
router.use(adminOnly);

// Dashboard stats
router.get("/dashboard/stats", getPlatformDashboardStats);

// Vendor management routes
router.get("/vendors", getAllVendors);
router.get("/vendors/pending", getPendingVendors);
router.get("/vendors/stats", getVendorStats);
router.get("/vendors/:id", getVendorById);
router.patch("/vendors/:id/approve", approveVendor);
router.patch("/vendors/:id/reject", rejectVendor);
router.patch("/vendors/:id/suspend", suspendVendor);
router.patch("/vendors/:id/reactivate", reactivateVendor);

// Customer management routes
router.get("/customers", getAllCustomers);
router.get("/customers/:id", getCustomerById);
router.patch("/customers/:id/suspend", suspendCustomer);
router.patch("/customers/:id/reactivate", reactivateCustomer);
router.delete("/customers/:id", deleteCustomer);

module.exports = router;
