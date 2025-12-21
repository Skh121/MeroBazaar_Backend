const asyncHandler = require("express-async-handler");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Product = require("../models/Product");

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

  // Calculate totals
  const subtotal = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const shippingCost = subtotal >= 1000 ? 0 : 100; // Free shipping over Rs.1000
  const tax = Math.round(subtotal * 0.05); // 5% tax
  const total = subtotal + shippingCost + tax;

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

  // Update product stock
  for (const item of orderItems) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: -item.quantity },
    });
  }

  // Clear cart
  cart.items = [];
  await cart.save();

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

// @desc    Get vendor order stats
// @route   GET /api/orders/vendor/stats
// @access  Private (Vendor)
const getVendorOrderStats = asyncHandler(async (req, res) => {
  const vendorId = req.vendor._id;

  // Get all orders containing vendor's products
  const orders = await Order.find({ "items.vendor": vendorId });

  // Calculate stats
  let totalRevenue = 0;
  let totalOrders = orders.length;
  let pendingOrders = 0;
  let completedOrders = 0;

  orders.forEach((order) => {
    // Calculate revenue from vendor's items only
    order.items.forEach((item) => {
      if (item.vendor && item.vendor.toString() === vendorId.toString()) {
        totalRevenue += item.price * item.quantity;
      }
    });

    if (
      order.orderStatus === "pending" ||
      order.orderStatus === "confirmed" ||
      order.orderStatus === "processing"
    ) {
      pendingOrders++;
    } else if (order.orderStatus === "delivered") {
      completedOrders++;
    }
  });

  res.json({
    totalRevenue,
    totalOrders,
    pendingOrders,
    completedOrders,
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
