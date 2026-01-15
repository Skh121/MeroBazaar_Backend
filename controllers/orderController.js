const asyncHandler = require("express-async-handler");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const {
  sendNewOrderNotification,
  sendLowStockNotification,
} = require("../services/emailService");

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = asyncHandler(async (req, res) => {
  const { shippingAddress, paymentMethod } = req.body;

  // Get user's cart
  const cart = await Cart.findOne({ user: req.user._id }).populate({
    path: "items.product",
    select: "name price images stock vendor",
  });

  if (!cart || cart.items.length === 0) {
    res.status(400);
    throw new Error("Cart is empty");
  }

  // Validate stock and prepare order items
  const orderItems = [];
  for (const item of cart.items) {
    const product = await Product.findById(item.product._id);

    if (!product) {
      res.status(404);
      throw new Error(`Product ${item.product.name} not found`);
    }

    if (product.stock < item.quantity) {
      res.status(400);
      throw new Error(`Not enough stock for ${product.name}`);
    }

    orderItems.push({
      product: item.product._id,
      name: item.product.name,
      quantity: item.quantity,
      price: item.price,
      image: item.product.images?.[0]?.url || "",
      vendor: item.product.vendor,
    });
  }

  // Calculate totals (round to 2 decimal places to avoid floating-point precision issues)
  const subtotal =
    Math.round(
      orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0) *
        100
    ) / 100;
  const shippingCost = subtotal >= 1000 ? 0 : 100; // Free shipping over Rs.1000
  const tax = Math.round(subtotal * 0.05 * 100) / 100; // 5% tax
  const total = Math.round((subtotal + shippingCost + tax) * 100) / 100;

  // Generate order number
  const randomStr = Math.random().toString(36).substring(2, 10).toUpperCase();
  const orderNumber = `ORD-${randomStr}`;

  // Create order
  const order = await Order.create({
    user: req.user._id,
    orderNumber,
    items: orderItems,
    shippingAddress,
    paymentMethod,
    subtotal,
    shippingCost,
    tax,
    total,
    paymentStatus: paymentMethod === "cod" ? "pending" : "pending",
    orderStatus: "pending",
  });

  // Update product stock and check for low stock
  const LOW_STOCK_THRESHOLD = 10;
  for (const item of orderItems) {
    const updatedProduct = await Product.findByIdAndUpdate(
      item.product,
      { $inc: { stock: -item.quantity } },
      { new: true }
    ).populate("vendor");

    // Send low stock notification if stock falls below threshold
    if (updatedProduct && updatedProduct.stock <= LOW_STOCK_THRESHOLD) {
      sendLowStockNotification(updatedProduct, updatedProduct.stock);
    }
  }

  // Clear cart
  cart.items = [];
  await cart.save();

  // Send new order notification to admin
  sendNewOrderNotification(order);

  res.status(201).json(order);
});

// @desc    Get user's orders
// @route   GET /api/orders
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .populate("items.vendor", "businessName");

  res.json(orders);
});

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user._id,
  }).populate("items.vendor", "businessName");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  res.json(order);
});

// @desc    Get order by order number
// @route   GET /api/orders/number/:orderNumber
// @access  Private
const getOrderByNumber = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    orderNumber: req.params.orderNumber,
    user: req.user._id,
  }).populate("items.vendor", "businessName");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  res.json(order);
});

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
const cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (order.orderStatus !== "pending" && order.orderStatus !== "confirmed") {
    res.status(400);
    throw new Error("Order cannot be cancelled at this stage");
  }

  // Restore product stock
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: item.quantity },
    });
  }

  order.orderStatus = "cancelled";
  await order.save();

  res.json(order);
});

// ==================== VENDOR ORDER FUNCTIONS ====================

// @desc    Get vendor's orders (orders containing their products)
// @route   GET /api/orders/vendor
// @access  Private (Vendor)
const getVendorOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ "items.vendor": req.vendor._id })
    .sort({ createdAt: -1 })
    .populate("user", "fullName email")
    .populate("items.vendor", "businessName");

  res.json(orders);
});

// @desc    Get vendor order stats with chart data
// @route   GET /api/orders/vendor/stats
// @access  Private (Vendor)
const getVendorOrderStats = asyncHandler(async (req, res) => {
  const vendorId = req.vendor._id;
  const { days = 7 } = req.query;

  // Get all orders containing vendor's products
  const orders = await Order.find({ "items.vendor": vendorId }).sort({
    createdAt: -1,
  });

  // Calculate basic stats
  let totalRevenue = 0;
  let totalOrders = orders.length;
  let pendingOrders = 0;
  let processingOrders = 0;
  let shippedOrders = 0;
  let completedOrders = 0;
  let cancelledOrders = 0;

  // For revenue chart - daily revenue for past N days
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(days));

  const revenueByDay = {};
  const ordersByDay = {};

  // Initialize all days with 0
  for (let i = 0; i < parseInt(days); i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split("T")[0];
    revenueByDay[dateKey] = 0;
    ordersByDay[dateKey] = 0;
  }

  // Product sales tracking
  const productSales = {};

  orders.forEach((order) => {
    const orderDate = new Date(order.createdAt).toISOString().split("T")[0];

    // Calculate revenue from vendor's items only
    let orderVendorRevenue = 0;
    order.items.forEach((item) => {
      if (item.vendor && item.vendor.toString() === vendorId.toString()) {
        const itemRevenue = item.price * item.quantity;
        totalRevenue += itemRevenue;
        orderVendorRevenue += itemRevenue;

        // Track product sales
        const productKey = item.product?.toString() || item.name;
        if (!productSales[productKey]) {
          productSales[productKey] = {
            name: item.name,
            sales: 0,
            revenue: 0,
            quantity: 0,
          };
        }
        productSales[productKey].sales += 1;
        productSales[productKey].quantity += item.quantity;
        productSales[productKey].revenue += itemRevenue;
      }
    });

    // Add to daily revenue if within the date range
    if (revenueByDay.hasOwnProperty(orderDate)) {
      revenueByDay[orderDate] += orderVendorRevenue;
      ordersByDay[orderDate] += 1;
    }

    // Count order statuses
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
      case "cancelled":
        cancelledOrders++;
        break;
    }
  });

  // Format revenue chart data (sorted by date ascending)
  const revenueChartData = Object.entries(revenueByDay)
    .sort(([a], [b]) => new Date(a) - new Date(b))
    .map(([date, revenue]) => ({
      date,
      revenue,
      orders: ordersByDay[date] || 0,
      label: new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    }));

  // Order status distribution for pie chart
  const orderStatusData = [
    { name: "Pending", value: pendingOrders, color: "#F59E0B" },
    { name: "Processing", value: processingOrders, color: "#3B82F6" },
    { name: "Shipped", value: shippedOrders, color: "#8B5CF6" },
    { name: "Delivered", value: completedOrders, color: "#10B981" },
    { name: "Cancelled", value: cancelledOrders, color: "#EF4444" },
  ].filter((item) => item.value > 0);

  // Top products by sales
  const topProducts = Object.values(productSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Calculate growth (compare this period vs previous period)
  const previousPeriodStart = new Date(daysAgo);
  previousPeriodStart.setDate(previousPeriodStart.getDate() - parseInt(days));

  const currentPeriodOrders = orders.filter(
    (o) => new Date(o.createdAt) >= daysAgo
  );
  const previousPeriodOrders = orders.filter((o) => {
    const orderDate = new Date(o.createdAt);
    return orderDate >= previousPeriodStart && orderDate < daysAgo;
  });

  let currentPeriodRevenue = 0;
  let previousPeriodRevenue = 0;

  currentPeriodOrders.forEach((order) => {
    order.items.forEach((item) => {
      if (item.vendor && item.vendor.toString() === vendorId.toString()) {
        currentPeriodRevenue += item.price * item.quantity;
      }
    });
  });

  previousPeriodOrders.forEach((order) => {
    order.items.forEach((item) => {
      if (item.vendor && item.vendor.toString() === vendorId.toString()) {
        previousPeriodRevenue += item.price * item.quantity;
      }
    });
  });

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
    previousPeriodOrders.length > 0
      ? (
          ((currentPeriodOrders.length - previousPeriodOrders.length) /
            previousPeriodOrders.length) *
          100
        ).toFixed(1)
      : currentPeriodOrders.length > 0
      ? 100
      : 0;

  res.json({
    // Basic stats
    totalRevenue,
    totalOrders,
    pendingOrders: pendingOrders + processingOrders,
    completedOrders,

    // Growth metrics
    revenueGrowth: parseFloat(revenueGrowth),
    ordersGrowth: parseFloat(ordersGrowth),
    currentPeriodRevenue,
    currentPeriodOrders: currentPeriodOrders.length,

    // Chart data
    revenueChartData,
    orderStatusData,
    topProducts,
  });
});

// @desc    Update order status (vendor)
// @route   PUT /api/orders/vendor/:id/status
// @access  Private (Vendor)
const updateOrderStatusVendor = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowedStatuses = ["processing", "shipped"];

  if (!allowedStatuses.includes(status)) {
    res.status(400);
    throw new Error("Vendors can only update status to processing or shipped");
  }

  const order = await Order.findOne({
    _id: req.params.id,
    "items.vendor": req.vendor._id,
  });

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  order.orderStatus = status;
  await order.save();

  res.json(order);
});

// ==================== ADMIN ORDER FUNCTIONS ====================

// @desc    Get all orders (admin)
// @route   GET /api/orders/admin
// @access  Private (Admin)
const getAllOrders = asyncHandler(async (req, res) => {
  const { status, paymentStatus, page = 1, limit = 20 } = req.query;

  const query = {};
  if (status) query.orderStatus = status;
  if (paymentStatus) query.paymentStatus = paymentStatus;

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .populate("user", "fullName email")
    .populate("items.vendor", "businessName");

  const total = await Order.countDocuments(query);

  res.json({
    orders,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Get admin order stats
// @route   GET /api/orders/admin/stats
// @access  Private (Admin)
const getAdminOrderStats = asyncHandler(async (req, res) => {
  const totalOrders = await Order.countDocuments();
  const pendingOrders = await Order.countDocuments({
    orderStatus: { $in: ["pending", "confirmed", "processing"] },
  });
  const completedOrders = await Order.countDocuments({
    orderStatus: "delivered",
  });
  const cancelledOrders = await Order.countDocuments({
    orderStatus: "cancelled",
  });

  // Calculate total revenue from paid orders
  const paidOrders = await Order.find({ paymentStatus: "paid" });
  const totalRevenue = paidOrders.reduce((sum, order) => sum + order.total, 0);

  // Pending payments
  const pendingPayments = await Order.countDocuments({
    paymentStatus: "pending",
  });

  res.json({
    totalOrders,
    pendingOrders,
    completedOrders,
    cancelledOrders,
    totalRevenue,
    pendingPayments,
  });
});

// @desc    Update order status (admin)
// @route   PUT /api/orders/admin/:id/status
// @access  Private (Admin)
const updateOrderStatusAdmin = asyncHandler(async (req, res) => {
  const { orderStatus, paymentStatus } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (orderStatus) {
    order.orderStatus = orderStatus;
  }

  if (paymentStatus) {
    order.paymentStatus = paymentStatus;
  }

  await order.save();

  res.json(order);
});

// @desc    Get order by ID (admin)
// @route   GET /api/orders/admin/:id
// @access  Private (Admin)
const getOrderByIdAdmin = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate("user", "fullName email phone")
    .populate("items.vendor", "businessName email phone");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  res.json(order);
});

module.exports = {
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
};
