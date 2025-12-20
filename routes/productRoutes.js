const express = require("express");
const {
  // Vendor operations
  createProduct,
  getVendorProducts,
  getVendorProductById,
  updateProduct,
  deleteProduct,
  // Public operations
  getAllProducts,
  getFeaturedProducts,
  getRegionalProducts,
  getProductById,
  getProductsByCategory,
} = require("../controllers/productController");
const {
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
  markReviewHelpful,
} = require("../controllers/reviewController");
const { protect, protectVendor } = require("../middleware/authMiddleware");

const router = express.Router();

// ============ PUBLIC ROUTES ============
// These must come before parameterized routes to avoid conflicts

// Get featured products (for landing page)
router.get("/featured", getFeaturedProducts);

// Get regional specialty products (for landing page)
router.get("/regional", getRegionalProducts);

// Get products by category
router.get("/category/:category", getProductsByCategory);

// Get all products (with pagination & filters)
router.get("/", getAllProducts);

// ============ VENDOR ROUTES ============
// Protected routes for vendor operations

// Get all products for the logged-in vendor
router.get("/vendor", protectVendor, getVendorProducts);

// Get single product for vendor (before /:id to avoid conflict)
router.get("/vendor/:id", protectVendor, getVendorProductById);

// Create a new product
router.post("/", protectVendor, createProduct);

// Update a product
router.put("/:id", protectVendor, updateProduct);

// Delete a product
router.delete("/:id", protectVendor, deleteProduct);

// ============ REVIEW ROUTES ============

// Get reviews for a product (public)
router.get("/:id/reviews", getProductReviews);

// Create a review (protected - logged in users)
router.post("/:id/reviews", protect, createReview);

// Update a review (protected - own review only)
router.put("/:id/reviews/:reviewId", protect, updateReview);

// Delete a review (protected - own review only)
router.delete("/:id/reviews/:reviewId", protect, deleteReview);

// Mark review as helpful (public)
router.post("/:id/reviews/:reviewId/helpful", markReviewHelpful);

// ============ PUBLIC SINGLE PRODUCT ============
// This must be last as it catches all /:id patterns

// Get single product by ID (public)
router.get("/:id", getProductById);

module.exports = router;
