const express = require("express");
const {
  createOrder,
  getMyOrders,
  getOrderById,
  getOrderByNumber,
  cancelOrder,
  // Vendor
  getVendorOrders,
  getVendorOrderStats,
  updateOrderStatusVendor,
  // Admin
  getAllOrders,
  getAdminOrderStats,
  updateOrderStatusAdmin,
  getOrderByIdAdmin,
} = require("../controllers/orderController");
const {
  protect,
  protectVendor,
  adminOnly,
} = require("../middleware/authMiddleware");

const router = express.Router();

// Customer routes
router.post("/", protect, createOrder);
router.get("/", protect, getMyOrders);
router.get("/number/:orderNumber", protect, getOrderByNumber);
router.get("/:id", protect, getOrderById);
router.put("/:id/cancel", protect, cancelOrder);

// Vendor routes
router.get("/vendor/all", protectVendor, getVendorOrders);
router.get("/vendor/stats", protectVendor, getVendorOrderStats);
router.put("/vendor/:id/status", protectVendor, updateOrderStatusVendor);

// Admin routes
router.get("/admin/all", protect, adminOnly, getAllOrders);
router.get("/admin/stats", protect, adminOnly, getAdminOrderStats);
router.get("/admin/:id", protect, adminOnly, getOrderByIdAdmin);
router.put("/admin/:id/status", protect, adminOnly, updateOrderStatusAdmin);

module.exports = router;
