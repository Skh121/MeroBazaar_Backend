const asyncHandler = require("express-async-handler");
const {
  UserEvent,
  UserProductInteraction,
  CustomerSegment,
  DemandForecast,
  DynamicPrice,
} = require("../models/UserBehavior");
const { trackEvent, getSessionId, isDuplicateView } = require("../middleware/trackingMiddleware");
const axios = require("axios");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// ============ EVENT TRACKING ============

// @desc    Track a user event
// @route   POST /api/analytics/track
// @access  Public
const trackUserEvent = asyncHandler(async (req, res) => {
  const { eventType, productId, category, searchQuery, quantity, price, metadata } = req.body;

  const event = await trackEvent({
    user: req.user?._id,
    sessionId: req.trackingContext?.sessionId || getSessionId(req),
    eventType,
    product: productId,
    category,
    searchQuery,
    quantity,
    price,
    metadata: {
      ...metadata,
      deviceType: req.trackingContext?.deviceType,
      browser: req.trackingContext?.browser,
      os: req.trackingContext?.os,
      referrer: req.trackingContext?.referrer,
    },
  });

  if (!event) {
    res.status(500);
    throw new Error("Failed to track event");
  }

  res.status(201).json({ success: true, eventId: event._id });
});

// @desc    Track batch events
// @route   POST /api/analytics/track/batch
// @access  Public
const trackBatchEvents = asyncHandler(async (req, res) => {
  const { events } = req.body;

  if (!Array.isArray(events) || events.length === 0) {
    res.status(400);
    throw new Error("Events array is required");
  }

  const sessionId = req.trackingContext?.sessionId || getSessionId(req);
  const userId = req.user?._id;

  let skippedDuplicates = 0;

  const trackedEvents = await Promise.all(
    events.map(async (event) => {
      // Skip duplicate view events within the deduplication window
      if (event.eventType === "view" && event.productId) {
        const isDuplicate = await isDuplicateView(sessionId, event.productId, userId);
        if (isDuplicate) {
          skippedDuplicates++;
          return null;
        }
      }

      return trackEvent({
        ...event,
        product: event.productId,
        user: userId,
        sessionId,
        metadata: {
          ...event.metadata,
          deviceType: req.trackingContext?.deviceType,
          browser: req.trackingContext?.browser,
          os: req.trackingContext?.os,
        },
      });
    })
  );

  const successCount = trackedEvents.filter(Boolean).length;

  res.status(201).json({
    success: true,
    tracked: successCount,
    skippedDuplicates,
    total: events.length,
  });
});

// ============ RECOMMENDATIONS ============

// @desc    Get personalized recommendations for user
// @route   GET /api/analytics/recommendations
// @access  Private
const getRecommendations = asyncHandler(async (req, res) => {
  const { limit = 10, type = "collaborative" } = req.query;
  const userId = req.user._id.toString();

  try {
    const response = await axios.get(`${ML_SERVICE_URL}/recommendations/${userId}`, {
      params: { limit, type },
      timeout: 5000,
    });

    res.json(response.data);
  } catch (error) {
    console.error("ML Service error:", error.message);

    // Fallback: Return popular products
    const popularProducts = await UserProductInteraction.aggregate([
      {
        $group: {
          _id: "$product",
          totalScore: { $sum: "$interactionScore" },
        },
      },
      { $sort: { totalScore: -1 } },
      { $limit: parseInt(limit) },
    ]);

    const productIds = popularProducts.map((p) => p._id);

    res.json({
      recommendations: productIds,
      type: "popular_fallback",
      message: "Using popular products as fallback",
    });
  }
});

// @desc    Get similar products
// @route   GET /api/analytics/recommendations/similar/:productId
// @access  Public
const getSimilarProducts = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { limit = 6 } = req.query;

  try {
    const response = await axios.get(`${ML_SERVICE_URL}/recommendations/similar/${productId}`, {
      params: { limit },
      timeout: 5000,
    });

    res.json(response.data);
  } catch (error) {
    console.error("ML Service error:", error.message);

    // Fallback: Return products from same category
    const Product = require("../models/Product");
    const product = await Product.findById(productId);

    if (product) {
      const similarProducts = await Product.find({
        _id: { $ne: productId },
        category: product.category,
        status: "active",
      })
        .limit(parseInt(limit))
        .select("_id name price images");

      res.json({
        similar_products: similarProducts.map((p) => p._id),
        type: "category_fallback",
      });
    } else {
      res.json({ similar_products: [], type: "fallback" });
    }
  }
});

// ============ CUSTOMER SEGMENTATION ============

// @desc    Get customer segments (Admin)
// @route   GET /api/analytics/segments
// @access  Private (Admin)
const getCustomerSegments = asyncHandler(async (req, res) => {
  const { segment, cluster, page = 1, limit = 20 } = req.query;

  const query = {};
  if (segment) query.segment = segment;
  if (cluster !== undefined) query.cluster = parseInt(cluster);

  const customers = await CustomerSegment.find(query)
    .populate("user", "fullName email")
    .sort({ rfmScore: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await CustomerSegment.countDocuments(query);

  // Get segment distribution
  const distribution = await CustomerSegment.aggregate([
    {
      $group: {
        _id: "$segment",
        count: { $sum: 1 },
        avgRfmScore: { $avg: "$rfmScore" },
        avgMonetary: { $avg: "$monetary" },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Convert distribution array to segmentSummary object for frontend
  const segmentSummary = {};
  distribution.forEach((d) => {
    segmentSummary[d._id] = {
      count: d.count,
      avgRfmScore: d.avgRfmScore,
      avgMonetary: d.avgMonetary,
    };
  });

  res.json({
    customers,
    segmentSummary,
    distribution,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Get user's segment
// @route   GET /api/analytics/segments/me
// @access  Private
const getMySegment = asyncHandler(async (req, res) => {
  const segment = await CustomerSegment.findOne({ user: req.user._id });

  if (!segment) {
    res.json({ segment: null, message: "Segment not yet calculated" });
    return;
  }

  res.json(segment);
});

// @desc    Trigger segment recalculation (Admin)
// @route   POST /api/analytics/segments/recalculate
// @access  Private (Admin)
const recalculateSegments = asyncHandler(async (req, res) => {
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/segmentation/calculate`, {}, { timeout: 60000 });

    res.json({
      success: true,
      message: "Segmentation calculation triggered",
      result: response.data,
    });
  } catch (error) {
    console.error("ML Service error:", error.message);
    res.status(500);
    throw new Error("Failed to trigger segmentation calculation");
  }
});

// ============ DEMAND FORECASTING ============

// @desc    Get demand forecasts (Admin/Vendor)
// @route   GET /api/analytics/forecasts
// @access  Private (Admin/Vendor)
const getDemandForecasts = asyncHandler(async (req, res) => {
  const { productId, category, startDate, endDate, page = 1, limit = 30 } = req.query;

  const query = {};

  if (productId) {
    query.product = productId;
  } else if (req.vendor) {
    // Vendors can only see their own products
    const Product = require("../models/Product");
    const vendorProducts = await Product.find({ vendor: req.vendor._id }).select("_id");
    query.product = { $in: vendorProducts.map((p) => p._id) };
  }

  if (category) query.category = category;

  if (startDate || endDate) {
    query.forecastDate = {};
    if (startDate) query.forecastDate.$gte = new Date(startDate);
    if (endDate) query.forecastDate.$lte = new Date(endDate);
  }

  const forecasts = await DemandForecast.find(query)
    .populate("product", "name category price")
    .sort({ forecastDate: 1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await DemandForecast.countDocuments(query);

  res.json({
    forecasts,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Generate demand forecast for a product
// @route   POST /api/analytics/forecasts/generate
// @access  Private (Admin)
const generateForecast = asyncHandler(async (req, res) => {
  const { productId, days = 30 } = req.body;

  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/forecasting/predict`,
      {
        product_id: productId,
        days: parseInt(days),
      },
      { timeout: 30000 }
    );

    res.json({
      success: true,
      forecast: response.data,
    });
  } catch (error) {
    console.error("ML Service error:", error.message);
    res.status(500);
    throw new Error("Failed to generate forecast");
  }
});

// ============ DYNAMIC PRICING ============

// @desc    Get dynamic prices (Admin/Vendor)
// @route   GET /api/analytics/pricing
// @access  Private (Admin/Vendor)
const getDynamicPrices = asyncHandler(async (req, res) => {
  const { productId, isActive = true, page = 1, limit = 20 } = req.query;

  const query = { isActive: isActive === "true" || isActive === true };

  if (productId) {
    query.product = productId;
  } else if (req.vendor) {
    const Product = require("../models/Product");
    const vendorProducts = await Product.find({ vendor: req.vendor._id }).select("_id");
    query.product = { $in: vendorProducts.map((p) => p._id) };
  }

  const prices = await DynamicPrice.find(query)
    .populate("product", "name category price stock")
    .sort({ calculatedAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await DynamicPrice.countDocuments(query);

  res.json({
    prices,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Calculate dynamic price for a product
// @route   POST /api/analytics/pricing/calculate
// @access  Private (Admin/Vendor)
const calculateDynamicPrice = asyncHandler(async (req, res) => {
  const { productId } = req.body;

  // Verify vendor owns this product if not admin
  if (req.vendor) {
    const Product = require("../models/Product");
    const product = await Product.findOne({ _id: productId, vendor: req.vendor._id });
    if (!product) {
      res.status(403);
      throw new Error("Not authorized to price this product");
    }
  }

  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/pricing/calculate`,
      { product_id: productId },
      { timeout: 10000 }
    );

    res.json({
      success: true,
      pricing: response.data,
    });
  } catch (error) {
    console.error("ML Service error:", error.message);
    res.status(500);
    throw new Error("Failed to calculate dynamic price");
  }
});

// @desc    Apply dynamic price to product
// @route   POST /api/analytics/pricing/apply
// @access  Private (Admin/Vendor)
const applyDynamicPrice = asyncHandler(async (req, res) => {
  const { productId, priceId } = req.body;

  const dynamicPrice = await DynamicPrice.findById(priceId);

  if (!dynamicPrice || dynamicPrice.product.toString() !== productId) {
    res.status(404);
    throw new Error("Dynamic price not found");
  }

  // Verify ownership
  const Product = require("../models/Product");
  const product = await Product.findById(productId);

  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  if (req.vendor && product.vendor.toString() !== req.vendor._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to update this product");
  }

  // Update product price
  product.price = dynamicPrice.recommendedPrice;
  await product.save();

  res.json({
    success: true,
    message: "Price updated successfully",
    newPrice: product.price,
  });
});

// ============ ANALYTICS DASHBOARD ============

// @desc    Get analytics overview (Admin)
// @route   GET /api/analytics/dashboard
// @access  Private (Admin)
const getDashboardAnalytics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  const timestampFilter = Object.keys(dateFilter).length > 0 ? { timestamp: dateFilter } : {};

  // Event counts by type
  const eventCounts = await UserEvent.aggregate([
    { $match: timestampFilter },
    {
      $group: {
        _id: "$eventType",
        count: { $sum: 1 },
      },
    },
  ]);

  // Daily event trends
  const dailyTrends = await UserEvent.aggregate([
    { $match: timestampFilter },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          eventType: "$eventType",
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  // Top viewed products
  const topViewedProducts = await UserEvent.aggregate([
    { $match: { ...timestampFilter, eventType: "view" } },
    {
      $group: {
        _id: "$product",
        views: { $sum: 1 },
      },
    },
    { $sort: { views: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
  ]);

  // Conversion funnel
  const funnelData = await UserEvent.aggregate([
    { $match: timestampFilter },
    {
      $group: {
        _id: "$sessionId",
        events: { $addToSet: "$eventType" },
      },
    },
    {
      $project: {
        viewed: { $in: ["view", "$events"] },
        addedToCart: { $in: ["add_to_cart", "$events"] },
        purchased: { $in: ["purchase", "$events"] },
      },
    },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        viewedSessions: { $sum: { $cond: ["$viewed", 1, 0] } },
        cartSessions: { $sum: { $cond: ["$addedToCart", 1, 0] } },
        purchaseSessions: { $sum: { $cond: ["$purchased", 1, 0] } },
      },
    },
  ]);

  // Segment distribution
  const segmentDistribution = await CustomerSegment.aggregate([
    {
      $group: {
        _id: "$segment",
        count: { $sum: 1 },
        avgMonetary: { $avg: "$monetary" },
      },
    },
    { $sort: { count: -1 } },
  ]);

  res.json({
    eventCounts,
    dailyTrends,
    topViewedProducts,
    conversionFunnel: funnelData[0] || {},
    segmentDistribution,
  });
});

// @desc    Get vendor analytics
// @route   GET /api/analytics/vendor/dashboard
// @access  Private (Vendor)
const getVendorAnalytics = asyncHandler(async (req, res) => {
  const Product = require("../models/Product");
  const vendorProducts = await Product.find({ vendor: req.vendor._id }).select("_id");
  const productIds = vendorProducts.map((p) => p._id);

  // Product views and interactions
  const productStats = await UserEvent.aggregate([
    {
      $match: {
        product: { $in: productIds },
      },
    },
    {
      $group: {
        _id: {
          product: "$product",
          eventType: "$eventType",
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // Daily trends for vendor products
  const dailyTrends = await UserEvent.aggregate([
    {
      $match: {
        product: { $in: productIds },
        timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
        },
        views: { $sum: { $cond: [{ $eq: ["$eventType", "view"] }, 1, 0] } },
        cartAdds: { $sum: { $cond: [{ $eq: ["$eventType", "add_to_cart"] }, 1, 0] } },
        purchases: { $sum: { $cond: [{ $eq: ["$eventType", "purchase"] }, 1, 0] } },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  res.json({
    productStats,
    dailyTrends,
    totalProducts: vendorProducts.length,
  });
});

module.exports = {
  trackUserEvent,
  trackBatchEvents,
  getRecommendations,
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
};
