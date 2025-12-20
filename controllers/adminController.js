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
  const vendor = await Vendor.findById(req.params.id).select("-password -otp -otpExpiry");

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

module.exports = {
  getAllVendors,
  getPendingVendors,
  getVendorById,
  approveVendor,
  rejectVendor,
  suspendVendor,
  reactivateVendor,
  getVendorStats,
};
