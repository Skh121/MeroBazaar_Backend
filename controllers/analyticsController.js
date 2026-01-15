const asyncHandler = require("express-async-handler");
const {
  UserEvent,
  UserProductInteraction,
  CustomerSegment,
  DemandForecast,
  DynamicPrice,
} = require("../models/UserBehavior");
const {
  trackEvent,
  getSessionId,
  isDuplicateView,
} = require("../middleware/trackingMiddleware");
const axios = require("axios");
const {
  getPersonalizedRecommendations,
  getTrendingProducts,
  getSeasonalProducts,
  getPopularProducts,
} = require("../services/recommendationService");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// ============ EVENT TRACKING ============

// @desc    Track a user event
// @route   POST /api/analytics/track
// @access  Public
const trackUserEvent = asyncHandler(async (req, res) => {
  const {
    eventType,
    productId,
    category,
    searchQuery,
    quantity,
    price,
    metadata,
  } = req.body;

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
        const isDuplicate = await isDuplicateView(
          sessionId,
          event.productId,
          userId
        );
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
  const { limit = 12, type = "forYou" } = req.query;
  const userId = req.user._id.toString();

  try {
    let result;

    switch (type) {
      case "trending":
        result = await getTrendingProducts(parseInt(limit));
        res.json({
          success: true,
          type: "trending",
          recommendations: result,
        });
        break;

      case "seasonal":
        result = await getSeasonalProducts(parseInt(limit));
        res.json({
          success: true,
          type: "seasonal",
          season: result.season,
          recommendations: result.products,
        });
        break;

      case "forYou":
      default:
        result = await getPersonalizedRecommendations(userId, parseInt(limit));
        res.json({
          success: true,
          type: "personalized",
          recommendations: result,
        });
        break;
    }
  } catch (error) {
    console.error("Recommendation error:", error.message);

    // Fallback: Return popular products
    const fallback = await getPopularProducts(parseInt(limit));
    res.json({
      success: true,
      type: "popular_fallback",
      recommendations: fallback,
      message: "Using popular products as fallback",
    });
  }
});

// @desc    Get trending products (public - for guests)
// @route   GET /api/analytics/recommendations/trending
// @access  Public
const getTrendingRecommendations = asyncHandler(async (req, res) => {
  const { limit = 12 } = req.query;

  try {
    const result = await getTrendingProducts(parseInt(limit));
    res.json({
      success: true,
      type: "trending",
      recommendations: result,
    });
  } catch (error) {
    console.error("Trending recommendations error:", error.message);
    res.status(500);
    throw new Error("Failed to fetch trending products");
  }
});

// @desc    Get seasonal products (public - for guests)
// @route   GET /api/analytics/recommendations/seasonal
// @access  Public
const getSeasonalRecommendations = asyncHandler(async (req, res) => {
  const { limit = 12 } = req.query;

  try {
    const result = await getSeasonalProducts(parseInt(limit));
    res.json({
      success: true,
      type: "seasonal",
      season: result.season,
      recommendations: result.products,
    });
  } catch (error) {
    console.error("Seasonal recommendations error:", error.message);
    res.status(500);
    throw new Error("Failed to fetch seasonal products");
  }
});

// @desc    Get similar products
// @route   GET /api/analytics/recommendations/similar/:productId
// @access  Public
const getSimilarProducts = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { limit = 6 } = req.query;

  try {
    const response = await axios.get(
      `${ML_SERVICE_URL}/recommendations/similar/${productId}`,
      {
        params: { limit },
        timeout: 5000,
      }
    );

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
    const response = await axios.post(
      `${ML_SERVICE_URL}/segmentation/calculate`,
      {},
      { timeout: 60000 }
    );

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
  const {
    productId,
    category,
    startDate,
    endDate,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (productId) {
    query.product = productId;
  } else if (req.vendor) {
    // Vendors can only see their own products
    const Product = require("../models/Product");
    const vendorProducts = await Product.find({
      vendor: req.vendor._id,
    }).select("_id");
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
    const vendorProducts = await Product.find({
      vendor: req.vendor._id,
    }).select("_id");
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
    const product = await Product.findOne({
      _id: productId,
      vendor: req.vendor._id,
    });
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

// ============ VENDOR-SPECIFIC ANALYTICS ============

// @desc    Get customer segments for vendor's customers only
// @route   GET /api/analytics/vendor/segments
// @access  Private (Vendor)
const getVendorCustomerSegments = asyncHandler(async (req, res) => {
  const Order = require("../models/Order");
  const Product = require("../models/Product");

  // Get vendor's products
  const vendorProducts = await Product.find({ vendor: req.vendor._id }).select(
    "_id"
  );
  const productIds = vendorProducts.map((p) => p._id);

  // Get all orders containing vendor's products
  const orders = await Order.find({ "items.vendor": req.vendor._id })
    .populate("user", "fullName email createdAt")
    .sort({ createdAt: -1 });

  // Build customer data map
  const customerMap = {};
  const now = new Date();

  orders.forEach((order) => {
    if (!order.user) return;
    const customerId = order.user._id.toString();

    // Calculate vendor-specific revenue from this order
    let vendorRevenue = 0;
    order.items.forEach((item) => {
      if (item.vendor && item.vendor.toString() === req.vendor._id.toString()) {
        vendorRevenue += item.price * item.quantity;
      }
    });

    if (!customerMap[customerId]) {
      customerMap[customerId] = {
        user: order.user,
        totalOrders: 0,
        totalSpent: 0,
        firstOrderDate: order.createdAt,
        lastOrderDate: order.createdAt,
        orderDates: [],
      };
    }

    customerMap[customerId].totalOrders += 1;
    customerMap[customerId].totalSpent += vendorRevenue;
    customerMap[customerId].orderDates.push(order.createdAt);

    if (order.createdAt < customerMap[customerId].firstOrderDate) {
      customerMap[customerId].firstOrderDate = order.createdAt;
    }
    if (order.createdAt > customerMap[customerId].lastOrderDate) {
      customerMap[customerId].lastOrderDate = order.createdAt;
    }
  });

  // Calculate RFM scores and segment customers
  const customers = Object.values(customerMap);
  const maxRecency = 365; // days
  const maxFrequency = Math.max(...customers.map((c) => c.totalOrders), 1);
  const maxMonetary = Math.max(...customers.map((c) => c.totalSpent), 1);

  const segmentedCustomers = customers.map((customer) => {
    const daysSinceLastOrder = Math.floor(
      (now - new Date(customer.lastOrderDate)) / (1000 * 60 * 60 * 24)
    );

    // RFM Scores (1-5 scale)
    const recencyScore = Math.max(
      1,
      Math.min(5, 5 - Math.floor((daysSinceLastOrder / maxRecency) * 5))
    );
    const frequencyScore = Math.max(
      1,
      Math.min(5, Math.ceil((customer.totalOrders / maxFrequency) * 5))
    );
    const monetaryScore = Math.max(
      1,
      Math.min(5, Math.ceil((customer.totalSpent / maxMonetary) * 5))
    );
    const rfmScore = recencyScore + frequencyScore + monetaryScore;

    // Determine segment
    let segment;
    if (rfmScore >= 13) {
      segment = "Champions";
    } else if (rfmScore >= 10 && recencyScore >= 4) {
      segment = "Loyal Customers";
    } else if (frequencyScore >= 4) {
      segment = "Potential Loyalists";
    } else if (recencyScore >= 4 && frequencyScore <= 2) {
      segment = "New Customers";
    } else if (recencyScore <= 2 && frequencyScore >= 3) {
      segment = "At Risk";
    } else if (recencyScore <= 2 && monetaryScore >= 3) {
      segment = "Can't Lose Them";
    } else if (recencyScore <= 2) {
      segment = "Hibernating";
    } else {
      segment = "Need Attention";
    }

    return {
      ...customer,
      daysSinceLastOrder,
      recencyScore,
      frequencyScore,
      monetaryScore,
      rfmScore,
      segment,
      avgOrderValue:
        customer.totalOrders > 0
          ? customer.totalSpent / customer.totalOrders
          : 0,
    };
  });

  // Calculate segment distribution
  const segmentDistribution = {};
  segmentedCustomers.forEach((c) => {
    if (!segmentDistribution[c.segment]) {
      segmentDistribution[c.segment] = {
        count: 0,
        totalRevenue: 0,
        avgOrderValue: 0,
      };
    }
    segmentDistribution[c.segment].count += 1;
    segmentDistribution[c.segment].totalRevenue += c.totalSpent;
  });

  // Calculate averages for each segment
  Object.keys(segmentDistribution).forEach((segment) => {
    const data = segmentDistribution[segment];
    data.avgOrderValue = data.count > 0 ? data.totalRevenue / data.count : 0;
  });

  // Segment colors for frontend
  const segmentColors = {
    Champions: "#10B981",
    "Loyal Customers": "#3B82F6",
    "Potential Loyalists": "#8B5CF6",
    "New Customers": "#06B6D4",
    "Need Attention": "#F59E0B",
    "At Risk": "#EF4444",
    "Can't Lose Them": "#EC4899",
    Hibernating: "#6B7280",
  };

  res.json({
    totalCustomers: customers.length,
    segments: segmentDistribution,
    segmentColors,
    customers: segmentedCustomers.slice(0, 50), // Return top 50 customers
    insights: {
      championsCount: segmentDistribution["Champions"]?.count || 0,
      atRiskCount: segmentDistribution["At Risk"]?.count || 0,
      newCustomersCount: segmentDistribution["New Customers"]?.count || 0,
      avgCustomerValue:
        customers.length > 0
          ? customers.reduce((sum, c) => sum + c.totalSpent, 0) /
            customers.length
          : 0,
    },
  });
});

// @desc    Get demand forecasting for vendor's products
// @route   GET /api/analytics/vendor/forecasts
// @access  Private (Vendor)
const getVendorDemandForecasts = asyncHandler(async (req, res) => {
  const Order = require("../models/Order");
  const Product = require("../models/Product");

  // Get vendor's products
  const vendorProducts = await Product.find({ vendor: req.vendor._id }).select(
    "_id name price stock category"
  );

  const productIds = vendorProducts.map((p) => p._id);

  // Get historical orders for vendor's products (last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const orders = await Order.find({
    "items.vendor": req.vendor._id,
    createdAt: { $gte: ninetyDaysAgo },
    orderStatus: { $ne: "cancelled" },
  });

  // Build sales data per product per day
  const productSalesMap = {};

  vendorProducts.forEach((product) => {
    productSalesMap[product._id.toString()] = {
      product,
      dailySales: {},
      totalSold: 0,
      totalRevenue: 0,
    };
  });

  orders.forEach((order) => {
    const orderDate = new Date(order.createdAt).toISOString().split("T")[0];

    order.items.forEach((item) => {
      if (item.vendor && item.vendor.toString() === req.vendor._id.toString()) {
        const productId = item.product?.toString();
        if (productSalesMap[productId]) {
          if (!productSalesMap[productId].dailySales[orderDate]) {
            productSalesMap[productId].dailySales[orderDate] = {
              quantity: 0,
              revenue: 0,
            };
          }
          productSalesMap[productId].dailySales[orderDate].quantity +=
            item.quantity;
          productSalesMap[productId].dailySales[orderDate].revenue +=
            item.price * item.quantity;
          productSalesMap[productId].totalSold += item.quantity;
          productSalesMap[productId].totalRevenue += item.price * item.quantity;
        }
      }
    });
  });

  // Calculate forecasts using simple moving average and trend analysis
  const forecasts = [];

  Object.values(productSalesMap).forEach((data) => {
    const salesArray = Object.entries(data.dailySales)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .map(([date, sales]) => ({ date, ...sales }));

    if (salesArray.length < 3) {
      // Not enough data for forecasting
      forecasts.push({
        product: data.product,
        historicalData: salesArray,
        forecast: null,
        trend: "insufficient_data",
        confidence: 0,
      });
      return;
    }

    // Calculate 7-day moving average
    const recentSales = salesArray.slice(-30);
    const avgDailySales =
      recentSales.reduce((sum, d) => sum + d.quantity, 0) / recentSales.length;

    // Calculate trend (comparing last 15 days to previous 15 days)
    const lastHalf = salesArray.slice(-15);
    const prevHalf = salesArray.slice(-30, -15);

    const lastHalfAvg =
      lastHalf.length > 0
        ? lastHalf.reduce((sum, d) => sum + d.quantity, 0) / lastHalf.length
        : 0;
    const prevHalfAvg =
      prevHalf.length > 0
        ? prevHalf.reduce((sum, d) => sum + d.quantity, 0) / prevHalf.length
        : lastHalfAvg;

    let trend = "stable";
    let trendPercentage = 0;

    if (prevHalfAvg > 0) {
      trendPercentage = ((lastHalfAvg - prevHalfAvg) / prevHalfAvg) * 100;
      if (trendPercentage > 15) trend = "increasing";
      else if (trendPercentage < -15) trend = "decreasing";
    }

    // Generate 14-day forecast
    const forecastDays = [];
    const trendMultiplier = 1 + (trendPercentage / 100) * 0.1; // Apply 10% of trend per day

    for (let i = 1; i <= 14; i++) {
      const forecastDate = new Date();
      forecastDate.setDate(forecastDate.getDate() + i);

      // Add some seasonality (weekends have lower sales)
      const dayOfWeek = forecastDate.getDay();
      const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.7 : 1.0;

      const predictedQuantity = Math.max(
        0,
        Math.round(
          avgDailySales * Math.pow(trendMultiplier, i / 7) * weekendFactor
        )
      );

      forecastDays.push({
        date: forecastDate.toISOString().split("T")[0],
        predictedQuantity,
        predictedRevenue: predictedQuantity * data.product.price,
      });
    }

    // Calculate confidence based on data consistency
    const variance =
      recentSales.length > 1
        ? recentSales.reduce(
            (sum, d) => sum + Math.pow(d.quantity - avgDailySales, 2),
            0
          ) / recentSales.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const coefficient = avgDailySales > 0 ? stdDev / avgDailySales : 1;
    const confidence = Math.max(
      0,
      Math.min(100, Math.round((1 - coefficient) * 100))
    );

    // Stock alert
    const next14DaysDemand = forecastDays.reduce(
      (sum, d) => sum + d.predictedQuantity,
      0
    );
    const stockStatus =
      data.product.stock >= next14DaysDemand * 1.2
        ? "adequate"
        : data.product.stock >= next14DaysDemand
        ? "low"
        : "critical";

    forecasts.push({
      product: data.product,
      historicalData: salesArray.slice(-30),
      avgDailySales: Math.round(avgDailySales * 10) / 10,
      trend,
      trendPercentage: Math.round(trendPercentage * 10) / 10,
      forecast: forecastDays,
      totalForecastDemand: next14DaysDemand,
      confidence,
      stockStatus,
      currentStock: data.product.stock,
      totalSold: data.totalSold,
      totalRevenue: data.totalRevenue,
    });
  });

  // Sort by total revenue (most important products first)
  forecasts.sort((a, b) => b.totalRevenue - a.totalRevenue);

  res.json({
    forecasts,
    summary: {
      totalProducts: forecasts.length,
      increasingTrend: forecasts.filter((f) => f.trend === "increasing").length,
      decreasingTrend: forecasts.filter((f) => f.trend === "decreasing").length,
      lowStockAlerts: forecasts.filter(
        (f) => f.stockStatus === "low" || f.stockStatus === "critical"
      ).length,
    },
  });
});

// @desc    Get enhanced dynamic pricing suggestions for vendor
// @route   GET /api/analytics/vendor/pricing-suggestions
// @access  Private (Vendor)
const getVendorPricingSuggestions = asyncHandler(async (req, res) => {
  const Order = require("../models/Order");
  const Product = require("../models/Product");

  // Get vendor's products with details
  const vendorProducts = await Product.find({
    vendor: req.vendor._id,
    status: "active",
  }).select("_id name price stock category compareAtPrice");

  // Get sales data for last 60 days
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const orders = await Order.find({
    "items.vendor": req.vendor._id,
    createdAt: { $gte: sixtyDaysAgo },
    orderStatus: { $ne: "cancelled" },
  });

  // Get view data for products
  const viewData = await UserEvent.aggregate([
    {
      $match: {
        product: { $in: vendorProducts.map((p) => p._id) },
        eventType: "view",
        timestamp: { $gte: sixtyDaysAgo },
      },
    },
    {
      $group: {
        _id: "$product",
        views: { $sum: 1 },
      },
    },
  ]);

  const viewMap = {};
  viewData.forEach((v) => {
    viewMap[v._id.toString()] = v.views;
  });

  // Calculate sales metrics per product
  const productMetrics = {};

  vendorProducts.forEach((product) => {
    productMetrics[product._id.toString()] = {
      product,
      totalSold: 0,
      totalRevenue: 0,
      views: viewMap[product._id.toString()] || 0,
      lastThirtyDaysSales: 0,
      prevThirtyDaysSales: 0,
    };
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  orders.forEach((order) => {
    const isLastThirtyDays = new Date(order.createdAt) >= thirtyDaysAgo;

    order.items.forEach((item) => {
      if (item.vendor && item.vendor.toString() === req.vendor._id.toString()) {
        const productId = item.product?.toString();
        if (productMetrics[productId]) {
          productMetrics[productId].totalSold += item.quantity;
          productMetrics[productId].totalRevenue += item.price * item.quantity;

          if (isLastThirtyDays) {
            productMetrics[productId].lastThirtyDaysSales += item.quantity;
          } else {
            productMetrics[productId].prevThirtyDaysSales += item.quantity;
          }
        }
      }
    });
  });

  // Generate pricing suggestions
  const suggestions = [];

  Object.values(productMetrics).forEach((data) => {
    const {
      product,
      totalSold,
      views,
      lastThirtyDaysSales,
      prevThirtyDaysSales,
    } = data;

    // Calculate conversion rate
    const conversionRate = views > 0 ? (totalSold / views) * 100 : 0;

    // Calculate demand trend
    let demandTrend = "stable";
    let trendPercentage = 0;

    if (prevThirtyDaysSales > 0) {
      trendPercentage =
        ((lastThirtyDaysSales - prevThirtyDaysSales) / prevThirtyDaysSales) *
        100;
      if (trendPercentage > 20) demandTrend = "high";
      else if (trendPercentage < -20) demandTrend = "low";
    } else if (lastThirtyDaysSales > 0) {
      demandTrend = "high";
      trendPercentage = 100;
    }

    // Stock level analysis
    const avgDailySales = lastThirtyDaysSales / 30;
    const daysOfStock = avgDailySales > 0 ? product.stock / avgDailySales : 999;

    // Generate price suggestion based on multiple factors
    let suggestedPrice = product.price;
    let adjustmentPercentage = 0;
    let reason = "";
    let priority = "low";

    // Rule 1: High demand + Low stock = Increase price
    if (demandTrend === "high" && daysOfStock < 14) {
      adjustmentPercentage = Math.min(15, Math.max(5, trendPercentage / 5));
      suggestedPrice = Math.round(
        product.price * (1 + adjustmentPercentage / 100)
      );
      reason = "High demand with limited stock";
      priority = "high";
    }
    // Rule 2: Low demand + High stock = Decrease price
    else if (demandTrend === "low" && daysOfStock > 60) {
      adjustmentPercentage = -Math.min(
        20,
        Math.max(5, Math.abs(trendPercentage) / 4)
      );
      suggestedPrice = Math.round(
        product.price * (1 + adjustmentPercentage / 100)
      );
      reason = "Low demand with excess inventory";
      priority = "high";
    }
    // Rule 3: Low conversion rate = Price might be too high
    else if (views > 50 && conversionRate < 1) {
      adjustmentPercentage = -10;
      suggestedPrice = Math.round(product.price * 0.9);
      reason = "Low conversion rate - consider competitive pricing";
      priority = "medium";
    }
    // Rule 4: High conversion + stable demand = Small increase
    else if (conversionRate > 5 && demandTrend !== "low") {
      adjustmentPercentage = 5;
      suggestedPrice = Math.round(product.price * 1.05);
      reason = "Strong conversion rate suggests room for price increase";
      priority = "low";
    }
    // Rule 5: Very low stock = Urgent increase
    else if (product.stock < 5 && avgDailySales > 0.5) {
      adjustmentPercentage = 10;
      suggestedPrice = Math.round(product.price * 1.1);
      reason = "Critical low stock - maximize margin";
      priority = "high";
    }

    suggestions.push({
      product: {
        _id: product._id,
        name: product.name,
        currentPrice: product.price,
        compareAtPrice: product.compareAtPrice,
        stock: product.stock,
        category: product.category,
      },
      metrics: {
        totalSold,
        views,
        conversionRate: Math.round(conversionRate * 100) / 100,
        demandTrend,
        trendPercentage: Math.round(trendPercentage * 10) / 10,
        daysOfStock: Math.round(daysOfStock),
        avgDailySales: Math.round(avgDailySales * 10) / 10,
      },
      suggestion: {
        recommendedPrice: suggestedPrice,
        adjustmentPercentage: Math.round(adjustmentPercentage * 10) / 10,
        reason,
        priority,
        potentialRevenue:
          adjustmentPercentage !== 0
            ? Math.round((suggestedPrice - product.price) * lastThirtyDaysSales)
            : 0,
      },
    });
  });

  // Sort by priority and potential impact
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => {
    if (
      priorityOrder[a.suggestion.priority] !==
      priorityOrder[b.suggestion.priority]
    ) {
      return (
        priorityOrder[a.suggestion.priority] -
        priorityOrder[b.suggestion.priority]
      );
    }
    return (
      Math.abs(b.suggestion.adjustmentPercentage) -
      Math.abs(a.suggestion.adjustmentPercentage)
    );
  });

  res.json({
    suggestions,
    summary: {
      totalProducts: suggestions.length,
      priceIncreaseOpportunities: suggestions.filter(
        (s) => s.suggestion.adjustmentPercentage > 0
      ).length,
      priceDecreaseRecommendations: suggestions.filter(
        (s) => s.suggestion.adjustmentPercentage < 0
      ).length,
      highPriorityCount: suggestions.filter(
        (s) => s.suggestion.priority === "high"
      ).length,
      potentialMonthlyRevenue: suggestions.reduce(
        (sum, s) => sum + Math.max(0, s.suggestion.potentialRevenue),
        0
      ),
    },
  });
});

// ============ ADMIN ANALYTICS (Dynamic from Orders) ============

// @desc    Get admin dashboard stats (like vendor dashboard but platform-wide)
// @route   GET /api/analytics/admin/stats
// @access  Private (Admin)
const getAdminDashboardStats = asyncHandler(async (req, res) => {
  const Order = require("../models/Order");
  const User = require("../models/User");
  const Product = require("../models/Product");

  const { days = 7 } = req.query;

  // Date ranges
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(days));

  const previousPeriodStart = new Date(daysAgo);
  previousPeriodStart.setDate(previousPeriodStart.getDate() - parseInt(days));

  // Get all orders
  const allOrders = await Order.find({ orderStatus: { $ne: "cancelled" } })
    .populate("user", "fullName email")
    .sort({ createdAt: -1 });

  // Calculate stats
  let totalRevenue = 0;
  let currentPeriodRevenue = 0;
  let previousPeriodRevenue = 0;
  let currentPeriodOrders = 0;
  let previousPeriodOrders = 0;

  const revenueByDay = {};
  const ordersByDay = {};

  // Initialize days
  for (let i = 0; i < parseInt(days); i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split("T")[0];
    revenueByDay[dateKey] = 0;
    ordersByDay[dateKey] = 0;
  }

  // Order status counts
  let pendingOrders = 0;
  let processingOrders = 0;
  let shippedOrders = 0;
  let completedOrders = 0;

  allOrders.forEach((order) => {
    const orderDate = new Date(order.createdAt);
    const dateKey = orderDate.toISOString().split("T")[0];

    totalRevenue += order.total;

    if (orderDate >= daysAgo) {
      currentPeriodRevenue += order.total;
      currentPeriodOrders++;
      if (revenueByDay.hasOwnProperty(dateKey)) {
        revenueByDay[dateKey] += order.total;
        ordersByDay[dateKey] += 1;
      }
    } else if (orderDate >= previousPeriodStart && orderDate < daysAgo) {
      previousPeriodRevenue += order.total;
      previousPeriodOrders++;
    }

    switch (order.orderStatus) {
      case "pending":
      case "confirmed":
        pendingOrders++;
        break;
      case "processing":
        processingOrders++;
        break;
      case "shipped":
        shippedOrders++;
        break;
      case "delivered":
        completedOrders++;
        break;
    }
  });

  // Calculate growth
  const revenueGrowth =
    previousPeriodRevenue > 0
      ? (
          ((currentPeriodRevenue - previousPeriodRevenue) /
            previousPeriodRevenue) *
          100
        ).toFixed(1)
      : currentPeriodRevenue > 0
      ? 100
      : 0;

  const ordersGrowth =
    previousPeriodOrders > 0
      ? (
          ((currentPeriodOrders - previousPeriodOrders) /
            previousPeriodOrders) *
          100
        ).toFixed(1)
      : currentPeriodOrders > 0
      ? 100
      : 0;

  // Revenue chart data
  const revenueChartData = Object.entries(revenueByDay)
    .sort(([a], [b]) => new Date(a) - new Date(b))
    .map(([date, revenue]) => ({
      date,
      revenue: Math.round(revenue * 100) / 100,
      orders: ordersByDay[date] || 0,
      label: new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    }));

  // Order status distribution
  const orderStatusData = [
    { name: "Pending", value: pendingOrders, color: "#F59E0B" },
    { name: "Processing", value: processingOrders, color: "#3B82F6" },
    { name: "Shipped", value: shippedOrders, color: "#8B5CF6" },
    { name: "Delivered", value: completedOrders, color: "#10B981" },
  ].filter((item) => item.value > 0);

  // Get counts
  const Vendor = require("../models/Vendor");
  const totalCustomers = await User.countDocuments({ role: "customer" });
  const totalProducts = await Product.countDocuments({ status: "active" });
  const totalVendors = await Vendor.countDocuments({ status: "approved" });

  // Top selling products
  const productSales = {};
  allOrders.forEach((order) => {
    order.items.forEach((item) => {
      const key = item.product?.toString() || item.name;
      if (!productSales[key]) {
        productSales[key] = { name: item.name, quantity: 0, revenue: 0 };
      }
      productSales[key].quantity += item.quantity;
      productSales[key].revenue += item.price * item.quantity;
    });
  });

  const topProducts = Object.values(productSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  res.json({
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalOrders: allOrders.length,
    totalCustomers,
    totalProducts,
    totalVendors,
    pendingOrders: pendingOrders + processingOrders,
    completedOrders,
    revenueGrowth: parseFloat(revenueGrowth),
    ordersGrowth: parseFloat(ordersGrowth),
    currentPeriodRevenue: Math.round(currentPeriodRevenue * 100) / 100,
    currentPeriodOrders,
    revenueChartData,
    orderStatusData,
    topProducts,
  });
});

// @desc    Get admin customer segments (platform-wide)
// @route   GET /api/analytics/admin/segments
// @access  Private (Admin)
const getAdminCustomerSegments = asyncHandler(async (req, res) => {
  const Order = require("../models/Order");

  // Get all orders with user data
  const orders = await Order.find({ orderStatus: { $ne: "cancelled" } })
    .populate("user", "fullName email createdAt")
    .sort({ createdAt: -1 });

  // Build customer data map
  const customerMap = {};
  const now = new Date();

  orders.forEach((order) => {
    if (!order.user) return;
    const customerId = order.user._id.toString();

    if (!customerMap[customerId]) {
      customerMap[customerId] = {
        user: order.user,
        totalOrders: 0,
        totalSpent: 0,
        firstOrderDate: order.createdAt,
        lastOrderDate: order.createdAt,
      };
    }

    customerMap[customerId].totalOrders += 1;
    customerMap[customerId].totalSpent += order.total;

    if (order.createdAt < customerMap[customerId].firstOrderDate) {
      customerMap[customerId].firstOrderDate = order.createdAt;
    }
    if (order.createdAt > customerMap[customerId].lastOrderDate) {
      customerMap[customerId].lastOrderDate = order.createdAt;
    }
  });

  // Calculate RFM scores and segment customers
  const customers = Object.values(customerMap);
  const maxRecency = 365;
  const maxFrequency = Math.max(...customers.map((c) => c.totalOrders), 1);
  const maxMonetary = Math.max(...customers.map((c) => c.totalSpent), 1);

  const segmentedCustomers = customers.map((customer) => {
    const daysSinceLastOrder = Math.floor(
      (now - new Date(customer.lastOrderDate)) / (1000 * 60 * 60 * 24)
    );

    const recencyScore = Math.max(
      1,
      Math.min(5, 5 - Math.floor((daysSinceLastOrder / maxRecency) * 5))
    );
    const frequencyScore = Math.max(
      1,
      Math.min(5, Math.ceil((customer.totalOrders / maxFrequency) * 5))
    );
    const monetaryScore = Math.max(
      1,
      Math.min(5, Math.ceil((customer.totalSpent / maxMonetary) * 5))
    );
    const rfmScore = recencyScore + frequencyScore + monetaryScore;

    let segment;
    if (rfmScore >= 13) segment = "Champions";
    else if (rfmScore >= 10 && recencyScore >= 4) segment = "Loyal Customers";
    else if (frequencyScore >= 4) segment = "Potential Loyalists";
    else if (recencyScore >= 4 && frequencyScore <= 2)
      segment = "New Customers";
    else if (recencyScore <= 2 && frequencyScore >= 3) segment = "At Risk";
    else if (recencyScore <= 2 && monetaryScore >= 3)
      segment = "Can't Lose Them";
    else if (recencyScore <= 2) segment = "Hibernating";
    else segment = "Need Attention";

    return {
      ...customer,
      daysSinceLastOrder,
      recencyScore,
      frequencyScore,
      monetaryScore,
      rfmScore,
      segment,
      avgOrderValue:
        customer.totalOrders > 0
          ? customer.totalSpent / customer.totalOrders
          : 0,
    };
  });

  // Calculate segment distribution
  const segmentDistribution = {};
  segmentedCustomers.forEach((c) => {
    if (!segmentDistribution[c.segment]) {
      segmentDistribution[c.segment] = {
        count: 0,
        totalRevenue: 0,
        avgOrderValue: 0,
      };
    }
    segmentDistribution[c.segment].count += 1;
    segmentDistribution[c.segment].totalRevenue += c.totalSpent;
  });

  Object.keys(segmentDistribution).forEach((segment) => {
    const data = segmentDistribution[segment];
    data.avgOrderValue = data.count > 0 ? data.totalRevenue / data.count : 0;
  });

  const segmentColors = {
    Champions: "#10B981",
    "Loyal Customers": "#3B82F6",
    "Potential Loyalists": "#8B5CF6",
    "New Customers": "#06B6D4",
    "Need Attention": "#F59E0B",
    "At Risk": "#EF4444",
    "Can't Lose Them": "#EC4899",
    Hibernating: "#6B7280",
  };

  res.json({
    totalCustomers: customers.length,
    segments: segmentDistribution,
    segmentColors,
    customers: segmentedCustomers
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 100),
    insights: {
      championsCount: segmentDistribution["Champions"]?.count || 0,
      atRiskCount: segmentDistribution["At Risk"]?.count || 0,
      newCustomersCount: segmentDistribution["New Customers"]?.count || 0,
      avgCustomerValue:
        customers.length > 0
          ? customers.reduce((sum, c) => sum + c.totalSpent, 0) /
            customers.length
          : 0,
    },
  });
});

// @desc    Get admin demand forecasting (platform-wide)
// @route   GET /api/analytics/admin/forecasts
// @access  Private (Admin)
const getAdminDemandForecasts = asyncHandler(async (req, res) => {
  const Order = require("../models/Order");
  const Product = require("../models/Product");

  // Get all active products
  const products = await Product.find({ status: "active" })
    .select("_id name price stock category vendor")
    .populate("vendor", "businessName");

  const productIds = products.map((p) => p._id);

  // Get historical orders (last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const orders = await Order.find({
    createdAt: { $gte: ninetyDaysAgo },
    orderStatus: { $ne: "cancelled" },
  });

  // Build sales data per product per day
  const productSalesMap = {};

  products.forEach((product) => {
    productSalesMap[product._id.toString()] = {
      product,
      dailySales: {},
      totalSold: 0,
      totalRevenue: 0,
    };
  });

  orders.forEach((order) => {
    const orderDate = new Date(order.createdAt).toISOString().split("T")[0];

    order.items.forEach((item) => {
      const productId = item.product?.toString();
      if (productSalesMap[productId]) {
        if (!productSalesMap[productId].dailySales[orderDate]) {
          productSalesMap[productId].dailySales[orderDate] = {
            quantity: 0,
            revenue: 0,
          };
        }
        productSalesMap[productId].dailySales[orderDate].quantity +=
          item.quantity;
        productSalesMap[productId].dailySales[orderDate].revenue +=
          item.price * item.quantity;
        productSalesMap[productId].totalSold += item.quantity;
        productSalesMap[productId].totalRevenue += item.price * item.quantity;
      }
    });
  });

  // Calculate forecasts
  const forecasts = [];

  Object.values(productSalesMap).forEach((data) => {
    const salesArray = Object.entries(data.dailySales)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .map(([date, sales]) => ({ date, ...sales }));

    if (salesArray.length < 3) {
      forecasts.push({
        product: data.product,
        historicalData: salesArray,
        forecast: null,
        trend: "insufficient_data",
        confidence: 0,
        totalSold: data.totalSold,
        totalRevenue: data.totalRevenue,
      });
      return;
    }

    const recentSales = salesArray.slice(-30);
    const avgDailySales =
      recentSales.reduce((sum, d) => sum + d.quantity, 0) / recentSales.length;

    const lastHalf = salesArray.slice(-15);
    const prevHalf = salesArray.slice(-30, -15);

    const lastHalfAvg =
      lastHalf.length > 0
        ? lastHalf.reduce((sum, d) => sum + d.quantity, 0) / lastHalf.length
        : 0;
    const prevHalfAvg =
      prevHalf.length > 0
        ? prevHalf.reduce((sum, d) => sum + d.quantity, 0) / prevHalf.length
        : lastHalfAvg;

    let trend = "stable";
    let trendPercentage = 0;

    if (prevHalfAvg > 0) {
      trendPercentage = ((lastHalfAvg - prevHalfAvg) / prevHalfAvg) * 100;
      if (trendPercentage > 15) trend = "increasing";
      else if (trendPercentage < -15) trend = "decreasing";
    }

    const forecastDays = [];
    const trendMultiplier = 1 + (trendPercentage / 100) * 0.1;

    for (let i = 1; i <= 14; i++) {
      const forecastDate = new Date();
      forecastDate.setDate(forecastDate.getDate() + i);

      const dayOfWeek = forecastDate.getDay();
      const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.7 : 1.0;

      const predictedQuantity = Math.max(
        0,
        Math.round(
          avgDailySales * Math.pow(trendMultiplier, i / 7) * weekendFactor
        )
      );

      forecastDays.push({
        date: forecastDate.toISOString().split("T")[0],
        predictedQuantity,
        predictedRevenue: predictedQuantity * data.product.price,
      });
    }

    const variance =
      recentSales.length > 1
        ? recentSales.reduce(
            (sum, d) => sum + Math.pow(d.quantity - avgDailySales, 2),
            0
          ) / recentSales.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const coefficient = avgDailySales > 0 ? stdDev / avgDailySales : 1;
    const confidence = Math.max(
      0,
      Math.min(100, Math.round((1 - coefficient) * 100))
    );

    const next14DaysDemand = forecastDays.reduce(
      (sum, d) => sum + d.predictedQuantity,
      0
    );
    const stockStatus =
      data.product.stock >= next14DaysDemand * 1.2
        ? "adequate"
        : data.product.stock >= next14DaysDemand
        ? "low"
        : "critical";

    forecasts.push({
      product: data.product,
      historicalData: salesArray.slice(-30),
      avgDailySales: Math.round(avgDailySales * 10) / 10,
      trend,
      trendPercentage: Math.round(trendPercentage * 10) / 10,
      forecast: forecastDays,
      totalForecastDemand: next14DaysDemand,
      confidence,
      stockStatus,
      currentStock: data.product.stock,
      totalSold: data.totalSold,
      totalRevenue: data.totalRevenue,
    });
  });

  forecasts.sort((a, b) => b.totalRevenue - a.totalRevenue);

  res.json({
    forecasts: forecasts.slice(0, 50),
    summary: {
      totalProducts: forecasts.length,
      increasingTrend: forecasts.filter((f) => f.trend === "increasing").length,
      decreasingTrend: forecasts.filter((f) => f.trend === "decreasing").length,
      lowStockAlerts: forecasts.filter(
        (f) => f.stockStatus === "low" || f.stockStatus === "critical"
      ).length,
    },
  });
});

// @desc    Get admin pricing suggestions (platform-wide)
// @route   GET /api/analytics/admin/pricing
// @access  Private (Admin)
const getAdminPricingSuggestions = asyncHandler(async (req, res) => {
  const Order = require("../models/Order");
  const Product = require("../models/Product");

  // Get all active products
  const products = await Product.find({ status: "active" })
    .select("_id name price stock category compareAtPrice vendor")
    .populate("vendor", "businessName");

  // Get sales data for last 60 days
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const orders = await Order.find({
    createdAt: { $gte: sixtyDaysAgo },
    orderStatus: { $ne: "cancelled" },
  });

  // Get view data for products
  const viewData = await UserEvent.aggregate([
    {
      $match: {
        product: { $in: products.map((p) => p._id) },
        eventType: "view",
        timestamp: { $gte: sixtyDaysAgo },
      },
    },
    {
      $group: {
        _id: "$product",
        views: { $sum: 1 },
      },
    },
  ]);

  const viewMap = {};
  viewData.forEach((v) => {
    viewMap[v._id.toString()] = v.views;
  });

  // Calculate sales metrics per product
  const productMetrics = {};

  products.forEach((product) => {
    productMetrics[product._id.toString()] = {
      product,
      totalSold: 0,
      totalRevenue: 0,
      views: viewMap[product._id.toString()] || 0,
      lastThirtyDaysSales: 0,
      prevThirtyDaysSales: 0,
    };
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  orders.forEach((order) => {
    const isLastThirtyDays = new Date(order.createdAt) >= thirtyDaysAgo;

    order.items.forEach((item) => {
      const productId = item.product?.toString();
      if (productMetrics[productId]) {
        productMetrics[productId].totalSold += item.quantity;
        productMetrics[productId].totalRevenue += item.price * item.quantity;

        if (isLastThirtyDays) {
          productMetrics[productId].lastThirtyDaysSales += item.quantity;
        } else {
          productMetrics[productId].prevThirtyDaysSales += item.quantity;
        }
      }
    });
  });

  // Generate pricing suggestions
  const suggestions = [];

  Object.values(productMetrics).forEach((data) => {
    const {
      product,
      totalSold,
      views,
      lastThirtyDaysSales,
      prevThirtyDaysSales,
    } = data;

    const conversionRate = views > 0 ? (totalSold / views) * 100 : 0;

    let demandTrend = "stable";
    let trendPercentage = 0;

    if (prevThirtyDaysSales > 0) {
      trendPercentage =
        ((lastThirtyDaysSales - prevThirtyDaysSales) / prevThirtyDaysSales) *
        100;
      if (trendPercentage > 20) demandTrend = "high";
      else if (trendPercentage < -20) demandTrend = "low";
    } else if (lastThirtyDaysSales > 0) {
      demandTrend = "high";
      trendPercentage = 100;
    }

    const avgDailySales = lastThirtyDaysSales / 30;
    const daysOfStock = avgDailySales > 0 ? product.stock / avgDailySales : 999;

    let suggestedPrice = product.price;
    let adjustmentPercentage = 0;
    let reason = "";
    let priority = "low";

    if (demandTrend === "high" && daysOfStock < 14) {
      adjustmentPercentage = Math.min(15, Math.max(5, trendPercentage / 5));
      suggestedPrice = Math.round(
        product.price * (1 + adjustmentPercentage / 100)
      );
      reason = "High demand with limited stock";
      priority = "high";
    } else if (demandTrend === "low" && daysOfStock > 60) {
      adjustmentPercentage = -Math.min(
        20,
        Math.max(5, Math.abs(trendPercentage) / 4)
      );
      suggestedPrice = Math.round(
        product.price * (1 + adjustmentPercentage / 100)
      );
      reason = "Low demand with excess inventory";
      priority = "high";
    } else if (views > 50 && conversionRate < 1) {
      adjustmentPercentage = -10;
      suggestedPrice = Math.round(product.price * 0.9);
      reason = "Low conversion rate - consider competitive pricing";
      priority = "medium";
    } else if (conversionRate > 5 && demandTrend !== "low") {
      adjustmentPercentage = 5;
      suggestedPrice = Math.round(product.price * 1.05);
      reason = "Strong conversion rate suggests room for price increase";
      priority = "low";
    } else if (product.stock < 5 && avgDailySales > 0.5) {
      adjustmentPercentage = 10;
      suggestedPrice = Math.round(product.price * 1.1);
      reason = "Critical low stock - maximize margin";
      priority = "high";
    }

    suggestions.push({
      product: {
        _id: product._id,
        name: product.name,
        currentPrice: product.price,
        compareAtPrice: product.compareAtPrice,
        stock: product.stock,
        category: product.category,
        vendor: product.vendor,
      },
      metrics: {
        totalSold,
        views,
        conversionRate: Math.round(conversionRate * 100) / 100,
        demandTrend,
        trendPercentage: Math.round(trendPercentage * 10) / 10,
        daysOfStock: Math.round(daysOfStock),
        avgDailySales: Math.round(avgDailySales * 10) / 10,
      },
      suggestion: {
        recommendedPrice: suggestedPrice,
        adjustmentPercentage: Math.round(adjustmentPercentage * 10) / 10,
        reason,
        priority,
        potentialRevenue:
          adjustmentPercentage !== 0
            ? Math.round((suggestedPrice - product.price) * lastThirtyDaysSales)
            : 0,
      },
    });
  });

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => {
    if (
      priorityOrder[a.suggestion.priority] !==
      priorityOrder[b.suggestion.priority]
    ) {
      return (
        priorityOrder[a.suggestion.priority] -
        priorityOrder[b.suggestion.priority]
      );
    }
    return (
      Math.abs(b.suggestion.adjustmentPercentage) -
      Math.abs(a.suggestion.adjustmentPercentage)
    );
  });

  res.json({
    suggestions: suggestions.slice(0, 50),
    summary: {
      totalProducts: suggestions.length,
      priceIncreaseOpportunities: suggestions.filter(
        (s) => s.suggestion.adjustmentPercentage > 0
      ).length,
      priceDecreaseRecommendations: suggestions.filter(
        (s) => s.suggestion.adjustmentPercentage < 0
      ).length,
      highPriorityCount: suggestions.filter(
        (s) => s.suggestion.priority === "high"
      ).length,
      potentialMonthlyRevenue: suggestions.reduce(
        (sum, s) => sum + Math.max(0, s.suggestion.potentialRevenue),
        0
      ),
    },
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

  const timestampFilter =
    Object.keys(dateFilter).length > 0 ? { timestamp: dateFilter } : {};

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
  const vendorProducts = await Product.find({ vendor: req.vendor._id }).select(
    "_id"
  );
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
        cartAdds: {
          $sum: { $cond: [{ $eq: ["$eventType", "add_to_cart"] }, 1, 0] },
        },
        purchases: {
          $sum: { $cond: [{ $eq: ["$eventType", "purchase"] }, 1, 0] },
        },
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
  // Vendor-specific analytics
  getVendorCustomerSegments,
  getVendorDemandForecasts,
  getVendorPricingSuggestions,
  // Admin-specific analytics (dynamic from Orders)
  getAdminDashboardStats,
  getAdminCustomerSegments,
  getAdminDemandForecasts,
  getAdminPricingSuggestions,
};
