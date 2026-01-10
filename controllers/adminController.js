const asyncHandler = require("express-async-handler");
const Vendor = require("../models/Vendor");

// @desc    Get all vendors
// @route   GET /api/admin/vendors
// @access  Private (Admin)
const getAllVendors = asyncHandler(async (req, res) => {
  const { status } = req.query;

  let query = {};
  if (status) {
    query.status = status;
  }

  const vendors = await Vendor.find(query)
    .select("-password -otp -otpExpiry")
    .sort({ createdAt: -1 });

  res.json(vendors);
});

// @desc    Get pending vendor applications
// @route   GET /api/admin/vendors/pending
// @access  Private (Admin)
const getPendingVendors = asyncHandler(async (req, res) => {
  const vendors = await Vendor.find({ status: "pending" })
    .select("-password -otp -otpExpiry")
    .sort({ createdAt: -1 });

  res.json(vendors);
});

// @desc    Get vendor by ID
// @route   GET /api/admin/vendors/:id
// @access  Private (Admin)
const getVendorById = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id).select(
    "-password -otp -otpExpiry"
  );

  if (vendor) {
    res.json(vendor);
  } else {
    res.status(404).json({ message: "Vendor not found" });
  }
});

// @desc    Approve vendor application
// @route   PATCH /api/admin/vendors/:id/approve
// @access  Private (Admin)
const approveVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);

  if (!vendor) {
    res.status(404).json({ message: "Vendor not found" });
    return;
  }

  if (vendor.status === "approved") {
    res.status(400).json({ message: "Vendor is already approved" });
    return;
  }

  vendor.status = "approved";
  vendor.approvedAt = new Date();
  vendor.approvedBy = req.user._id;
  vendor.adminNotes = req.body.notes || null;

  await vendor.save();

  res.json({
    message: "Vendor approved successfully",
    vendor: {
      _id: vendor._id,
      businessName: vendor.businessName,
      ownerName: vendor.ownerName,
      email: vendor.email,
      status: vendor.status,
      approvedAt: vendor.approvedAt,
    },
  });
});

// @desc    Reject vendor application
// @route   PATCH /api/admin/vendors/:id/reject
// @access  Private (Admin)
const rejectVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);

  if (!vendor) {
    res.status(404).json({ message: "Vendor not found" });
    return;
  }

  if (vendor.status === "rejected") {
    res.status(400).json({ message: "Vendor is already rejected" });
    return;
  }

  vendor.status = "rejected";
  vendor.adminNotes = req.body.reason || "Application rejected by admin";

  await vendor.save();

  res.json({
    message: "Vendor rejected",
    vendor: {
      _id: vendor._id,
      businessName: vendor.businessName,
      ownerName: vendor.ownerName,
      email: vendor.email,
      status: vendor.status,
      adminNotes: vendor.adminNotes,
    },
  });
});

// @desc    Suspend vendor
// @route   PATCH /api/admin/vendors/:id/suspend
// @access  Private (Admin)
const suspendVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);

  if (!vendor) {
    res.status(404).json({ message: "Vendor not found" });
    return;
  }

  if (vendor.status === "suspended") {
    res.status(400).json({ message: "Vendor is already suspended" });
    return;
  }

  vendor.status = "suspended";
  vendor.adminNotes = req.body.reason || "Account suspended by admin";

  await vendor.save();

  res.json({
    message: "Vendor suspended",
    vendor: {
      _id: vendor._id,
      businessName: vendor.businessName,
      email: vendor.email,
      status: vendor.status,
    },
  });
});

// @desc    Reactivate vendor
// @route   PATCH /api/admin/vendors/:id/reactivate
// @access  Private (Admin)
const reactivateVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);

  if (!vendor) {
    res.status(404).json({ message: "Vendor not found" });
    return;
  }

  if (vendor.status === "approved") {
    res.status(400).json({ message: "Vendor is already active" });
    return;
  }

  vendor.status = "approved";
  vendor.adminNotes = null;

  await vendor.save();

  res.json({
    message: "Vendor reactivated",
    vendor: {
      _id: vendor._id,
      businessName: vendor.businessName,
      email: vendor.email,
      status: vendor.status,
    },
  });
});

// @desc    Get vendor statistics
// @route   GET /api/admin/vendors/stats
// @access  Private (Admin)
const getVendorStats = asyncHandler(async (req, res) => {
  const totalVendors = await Vendor.countDocuments();
  const pendingVendors = await Vendor.countDocuments({ status: "pending" });
  const approvedVendors = await Vendor.countDocuments({ status: "approved" });
  const rejectedVendors = await Vendor.countDocuments({ status: "rejected" });
  const suspendedVendors = await Vendor.countDocuments({ status: "suspended" });

  res.json({
    total: totalVendors,
    pending: pendingVendors,
    approved: approvedVendors,
    rejected: rejectedVendors,
    suspended: suspendedVendors,
  });
});

// @desc    Get platform dashboard stats
// @route   GET /api/admin/dashboard/stats
// @access  Private (Admin)
const getPlatformDashboardStats = asyncHandler(async (req, res) => {
  const Order = require("../models/Order");
  const User = require("../models/User");
  const Product = require("../models/Product");

  // Get current date info
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Calculate date ranges
  const thisMonthStart = new Date(currentYear, currentMonth, 1);
  const lastMonthStart = new Date(currentYear, currentMonth - 1, 1);
  const lastMonthEnd = new Date(currentYear, currentMonth, 0);
  const sixMonthsAgo = new Date(currentYear, currentMonth - 5, 1);

  // Total Revenue
  const allOrders = await Order.find({ orderStatus: { $ne: "cancelled" } });
  const totalRevenue = allOrders.reduce(
    (sum, order) => sum + (order.total || 0),
    0
  );

  // This month's revenue
  const thisMonthOrders = await Order.find({
    orderStatus: { $ne: "cancelled" },
    createdAt: { $gte: thisMonthStart },
  });
  const thisMonthRevenue = thisMonthOrders.reduce(
    (sum, order) => sum + (order.total || 0),
    0
  );

  // Last month's revenue
  const lastMonthOrders = await Order.find({
    orderStatus: { $ne: "cancelled" },
    createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd },
  });
  const lastMonthRevenue = lastMonthOrders.reduce(
    (sum, order) => sum + (order.total || 0),
    0
  );

  // Revenue growth
  const revenueGrowth =
    lastMonthRevenue > 0
      ? (
          ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) *
          100
        ).toFixed(1)
      : thisMonthRevenue > 0
      ? 100
      : 0;

  // Active Vendors
  const activeVendors = await Vendor.countDocuments({ status: "approved" });
  const newVendorsThisMonth = await Vendor.countDocuments({
    status: "approved",
    approvedAt: { $gte: thisMonthStart },
  });

  // Total Customers
  const totalCustomers = await User.countDocuments({ role: "customer" });
  const newCustomersThisMonth = await User.countDocuments({
    role: "customer",
    createdAt: { $gte: thisMonthStart },
  });

  // Total Orders
  const totalOrders = await Order.countDocuments();
  const ordersThisMonth = await Order.countDocuments({
    createdAt: { $gte: thisMonthStart },
  });
  const ordersLastMonth = await Order.countDocuments({
    createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd },
  });
  const ordersGrowth =
    ordersLastMonth > 0
      ? (((ordersThisMonth - ordersLastMonth) / ordersLastMonth) * 100).toFixed(
          1
        )
      : ordersThisMonth > 0
      ? 100
      : 0;

  // Revenue Trend (Last 6 months)
  const revenueTrend = [];
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(currentYear, currentMonth - i, 1);
    const monthEnd = new Date(currentYear, currentMonth - i + 1, 0);

    const monthOrders = await Order.find({
      orderStatus: { $ne: "cancelled" },
      createdAt: { $gte: monthStart, $lte: monthEnd },
    });

    const monthRevenue = monthOrders.reduce(
      (sum, order) => sum + (order.total || 0),
      0
    );

    revenueTrend.push({
      month: monthStart.toLocaleString("default", { month: "short" }),
      revenue: monthRevenue,
      orders: monthOrders.length,
    });
  }

  // Regional Distribution (by province from vendor orders)
  const regionalData = await Order.aggregate([
    { $match: { orderStatus: { $ne: "cancelled" } } },
    { $unwind: "$items" },
    {
      $lookup: {
        from: "vendors",
        localField: "items.vendor",
        foreignField: "_id",
        as: "vendorInfo",
      },
    },
    { $unwind: { path: "$vendorInfo", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$vendorInfo.province",
        totalSales: {
          $sum: { $multiply: ["$items.price", "$items.quantity"] },
        },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalSales: -1 } },
  ]);

  // Format regional data with colors
  const provinceColors = {
    "Bagmati Province": "#10B981",
    "Gandaki Province": "#3B82F6",
    "Lumbini Province": "#8B5CF6",
    "Koshi Province": "#F59E0B",
    "Madhesh Province": "#EF4444",
    "Sudurpashchim Province": "#EC4899",
    "Karnali Province": "#06B6D4",
  };

  const totalRegionalSales = regionalData.reduce(
    (sum, r) => sum + (r.totalSales || 0),
    0
  );
  const regionalDistribution = regionalData
    .filter((r) => r._id)
    .map((r) => ({
      name: r._id?.replace(" Province", "") || "Unknown",
      fullName: r._id || "Unknown",
      value: r.totalSales,
      percentage:
        totalRegionalSales > 0
          ? Math.round((r.totalSales / totalRegionalSales) * 100)
          : 0,
      color: provinceColors[r._id] || "#6B7280",
    }))
    .slice(0, 6);

  // Add "Others" if there are more regions
  if (regionalData.length > 6) {
    const othersTotal = regionalData
      .slice(6)
      .reduce((sum, r) => sum + (r.totalSales || 0), 0);
    regionalDistribution.push({
      name: "Others",
      fullName: "Others",
      value: othersTotal,
      percentage:
        totalRegionalSales > 0
          ? Math.round((othersTotal / totalRegionalSales) * 100)
          : 0,
      color: "#9CA3AF",
    });
  }

  // Top Performing Vendors
  const vendorPerformance = await Order.aggregate([
    { $match: { orderStatus: { $ne: "cancelled" } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.vendor",
        totalRevenue: {
          $sum: { $multiply: ["$items.price", "$items.quantity"] },
        },
        totalOrders: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "vendors",
        localField: "_id",
        foreignField: "_id",
        as: "vendorInfo",
      },
    },
    { $unwind: { path: "$vendorInfo", preserveNullAndEmptyArrays: true } },
  ]);

  // Get product counts for top vendors
  const topVendors = await Promise.all(
    vendorPerformance.map(async (v) => {
      const productCount = await Product.countDocuments({
        vendor: v._id,
        status: "active",
      });

      // Calculate growth (comparing this month vs last month for this vendor)
      const thisMonthVendorOrders = await Order.aggregate([
        {
          $match: {
            "items.vendor": v._id,
            orderStatus: { $ne: "cancelled" },
            createdAt: { $gte: thisMonthStart },
          },
        },
        { $unwind: "$items" },
        { $match: { "items.vendor": v._id } },
        {
          $group: {
            _id: null,
            revenue: {
              $sum: { $multiply: ["$items.price", "$items.quantity"] },
            },
          },
        },
      ]);

      const lastMonthVendorOrders = await Order.aggregate([
        {
          $match: {
            "items.vendor": v._id,
            orderStatus: { $ne: "cancelled" },
            createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd },
          },
        },
        { $unwind: "$items" },
        { $match: { "items.vendor": v._id } },
        {
          $group: {
            _id: null,
            revenue: {
              $sum: { $multiply: ["$items.price", "$items.quantity"] },
            },
          },
        },
      ]);

      const thisMonthRev = thisMonthVendorOrders[0]?.revenue || 0;
      const lastMonthRev = lastMonthVendorOrders[0]?.revenue || 0;
      const growth =
        lastMonthRev > 0
          ? (((thisMonthRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1)
          : thisMonthRev > 0
          ? 100
          : 0;

      return {
        _id: v._id,
        businessName: v.vendorInfo?.businessName || "Unknown Vendor",
        revenue: v.totalRevenue,
        orders: v.totalOrders,
        products: productCount,
        growth: parseFloat(growth),
      };
    })
  );

  res.json({
    stats: {
      totalRevenue,
      revenueGrowth: parseFloat(revenueGrowth),
      activeVendors,
      newVendorsThisMonth,
      totalCustomers,
      newCustomersThisMonth,
      totalOrders,
      ordersThisMonth,
      ordersGrowth: parseFloat(ordersGrowth),
    },
    revenueTrend,
    regionalDistribution,
    topVendors,
  });
});

// @desc    Get all customers
// @route   GET /api/admin/customers
// @access  Private (Admin)
const getAllCustomers = asyncHandler(async (req, res) => {
  const User = require("../models/User");
  const Order = require("../models/Order");

  const { page = 1, limit = 20, search } = req.query;

  let query = { role: "customer" };
  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const customers = await User.find(query)
    .select("-password -otp -otpExpiry")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  // Get order stats for each customer
  const customersWithStats = await Promise.all(
    customers.map(async (customer) => {
      const orders = await Order.find({ user: customer._id });
      const totalSpent = orders.reduce(
        (sum, order) => sum + (order.total || 0),
        0
      );
      return {
        ...customer.toObject(),
        totalOrders: orders.length,
        totalSpent,
        lastOrderDate: orders.length > 0 ? orders[0].createdAt : null,
      };
    })
  );

  const total = await User.countDocuments(query);

  res.json({
    customers: customersWithStats,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Get customer by ID
// @route   GET /api/admin/customers/:id
// @access  Private (Admin)
const getCustomerById = asyncHandler(async (req, res) => {
  const User = require("../models/User");
  const Order = require("../models/Order");

  const customer = await User.findById(req.params.id).select(
    "-password -otp -otpExpiry"
  );

  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return;
  }

  // Get order stats
  const orders = await Order.find({ user: customer._id }).sort({
    createdAt: -1,
  });
  const totalSpent = orders.reduce((sum, order) => sum + (order.total || 0), 0);

  res.json({
    ...customer.toObject(),
    totalOrders: orders.length,
    totalSpent,
    recentOrders: orders.slice(0, 5),
    lastOrderDate: orders.length > 0 ? orders[0].createdAt : null,
  });
});

// @desc    Suspend customer
// @route   PATCH /api/admin/customers/:id/suspend
// @access  Private (Admin)
const suspendCustomer = asyncHandler(async (req, res) => {
  const User = require("../models/User");

  const customer = await User.findById(req.params.id);

  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return;
  }

  if (customer.status === "suspended") {
    res.status(400).json({ message: "Customer is already suspended" });
    return;
  }

  customer.status = "suspended";
  customer.suspendedAt = new Date();
  customer.suspendReason = req.body.reason || "Suspended by admin";

  await customer.save();

  res.json({
    message: "Customer suspended successfully",
    customer: {
      _id: customer._id,
      fullName: customer.fullName,
      email: customer.email,
      status: customer.status,
    },
  });
});

// @desc    Reactivate customer
// @route   PATCH /api/admin/customers/:id/reactivate
// @access  Private (Admin)
const reactivateCustomer = asyncHandler(async (req, res) => {
  const User = require("../models/User");

  const customer = await User.findById(req.params.id);

  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return;
  }

  if (customer.status !== "suspended") {
    res.status(400).json({ message: "Customer is not suspended" });
    return;
  }

  customer.status = "active";
  customer.suspendedAt = null;
  customer.suspendReason = null;

  await customer.save();

  res.json({
    message: "Customer reactivated successfully",
    customer: {
      _id: customer._id,
      fullName: customer.fullName,
      email: customer.email,
      status: customer.status,
    },
  });
});

// @desc    Delete customer
// @route   DELETE /api/admin/customers/:id
// @access  Private (Admin)
const deleteCustomer = asyncHandler(async (req, res) => {
  const User = require("../models/User");

  const customer = await User.findById(req.params.id);

  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return;
  }

  if (customer.role === "admin") {
    res.status(400).json({ message: "Cannot delete admin users" });
    return;
  }

  await User.findByIdAndDelete(req.params.id);

  res.json({
    message: "Customer deleted successfully",
    customerId: req.params.id,
  });
});

module.exports = {
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
};
