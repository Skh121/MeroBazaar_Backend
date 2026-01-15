const express = require("express");
const router = express.Router();
const {
  trackUserEvent,
  trackBatchEvents,
  getRecommendations,
  getTrendingRecommendations,
  getSeasonalRecommendations,
  getSimilarProducts,
  getCustomerSegments,
  getMySegment,
  recalculateSegments,
  getDemandForecasts,
  generateForecast,
  getDynamicPrices,
  calculateDynamicPrice,
  applyDynamicPrice,
  getDashboardAnalytics,
  getVendorAnalytics,
  getVendorCustomerSegments,
  getVendorDemandForecasts,
  getVendorPricingSuggestions,
  // Admin-specific analytics
  getAdminDashboardStats,
  getAdminCustomerSegments,
  getAdminDemandForecasts,
  getAdminPricingSuggestions,
} = require("../controllers/analyticsController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { protectVendor } = require("../middleware/authMiddleware");
const { trackingContext } = require("../middleware/trackingMiddleware");

// Apply tracking context to all routes
router.use(trackingContext);

// ============ EVENT TRACKING (Public/Auth) ============
router.post("/track", trackUserEvent);
router.post("/track/batch", trackBatchEvents);

// ============ RECOMMENDATIONS ============
router.get("/recommendations", protect, getRecommendations);
router.get("/recommendations/trending", getTrendingRecommendations); // Public
router.get("/recommendations/seasonal", getSeasonalRecommendations); // Public
router.get("/recommendations/similar/:productId", getSimilarProducts); // Public

// ============ CUSTOMER SEGMENTATION ============
router.get("/segments", protect, adminOnly, getCustomerSegments);
router.get("/segments/me", protect, getMySegment);
router.post("/segments/recalculate", protect, adminOnly, recalculateSegments);

// ============ DEMAND FORECASTING ============
router.get("/forecasts", protect, getDemandForecasts);
router.post("/forecasts/generate", protect, adminOnly, generateForecast);

// ============ DYNAMIC PRICING ============
router.get("/pricing", protect, getDynamicPrices);
router.post("/pricing/calculate", protect, calculateDynamicPrice);
router.post("/pricing/apply", protect, applyDynamicPrice);

// ============ DASHBOARD ANALYTICS ============
router.get("/dashboard", protect, adminOnly, getDashboardAnalytics);
router.get("/vendor/dashboard", protectVendor, getVendorAnalytics);

// ============ VENDOR-SPECIFIC ROUTES ============
router.get("/vendor/pricing", protectVendor, getDynamicPrices);
router.post("/vendor/pricing/calculate", protectVendor, calculateDynamicPrice);
router.get("/vendor/segments", protectVendor, getVendorCustomerSegments);
router.get("/vendor/forecasts", protectVendor, getVendorDemandForecasts);
router.get(
  "/vendor/pricing-suggestions",
  protectVendor,
  getVendorPricingSuggestions
);

// ============ ADMIN-SPECIFIC ROUTES (Dynamic from Orders) ============
router.get("/admin/stats", protect, adminOnly, getAdminDashboardStats);
router.get("/admin/segments", protect, adminOnly, getAdminCustomerSegments);
router.get("/admin/forecasts", protect, adminOnly, getAdminDemandForecasts);
router.get("/admin/pricing", protect, adminOnly, getAdminPricingSuggestions);

module.exports = router;
