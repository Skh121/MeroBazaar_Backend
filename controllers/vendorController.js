const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const Vendor = require("../models/Vendor");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// @desc    Register a new vendor
// @route   POST /api/vendor/auth/register
// @access  Public
const registerVendor = asyncHandler(async (req, res) => {
  const {
    businessName,
    category,
    panNumber,
    phone,
    ownerName,
    email,
    province,
    district,
    address,
    password,
  } = req.body;

  // Check if vendor already exists with email
  const vendorExistsByEmail = await Vendor.findOne({ email });
  if (vendorExistsByEmail) {
    res.status(400).json({ message: "A vendor already exists with this email address." });
    return;
  }

  // Check if vendor already exists with PAN number
  const vendorExistsByPAN = await Vendor.findOne({ panNumber });
  if (vendorExistsByPAN) {
    res.status(400).json({ message: "A vendor already exists with this PAN number." });
    return;
  }

  // Create vendor with pending status
  const vendor = await Vendor.create({
    businessName,
    category,
    panNumber,
    phone,
    ownerName,
    email,
    province,
    district,
    address,
    password,
    status: "pending",
  });

  if (vendor) {
    res.status(201).json({
      _id: vendor._id,
      businessName: vendor.businessName,
      ownerName: vendor.ownerName,
      email: vendor.email,
      status: vendor.status,
      message: "Registration successful! Your application is pending admin approval.",
    });
  } else {
    res.status(400).json({ message: "Invalid vendor data provided." });
  }
});

// @desc    Authenticate vendor & get token
// @route   POST /api/vendor/auth/login
// @access  Public
const authVendor = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const vendor = await Vendor.findOne({ email });

  if (!vendor) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  // Check password
  const isMatch = await vendor.matchPassword(password);
  if (!isMatch) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  // Check vendor status
  if (vendor.status === "pending") {
    res.status(403).json({
      message: "Your account is pending approval. Please wait for admin verification.",
      status: "pending",
    });
    return;
  }

  if (vendor.status === "rejected") {
    res.status(403).json({
      message: "Your vendor application was rejected. Please contact support.",
      status: "rejected",
      reason: vendor.adminNotes,
    });
    return;
  }

  if (vendor.status === "suspended") {
    res.status(403).json({
      message: "Your vendor account has been suspended. Please contact support.",
      status: "suspended",
      reason: vendor.adminNotes,
    });
    return;
  }

  // Only approved vendors can login
  res.json({
    _id: vendor._id,
    businessName: vendor.businessName,
    ownerName: vendor.ownerName,
    email: vendor.email,
    category: vendor.category,
    phone: vendor.phone,
    province: vendor.province,
    district: vendor.district,
    address: vendor.address,
    status: vendor.status,
    token: generateToken(vendor._id),
  });
});

// @desc    Get vendor profile
// @route   GET /api/vendor/profile
// @access  Private (Vendor)
const getVendorProfile = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.vendor._id).select("-password");

  if (vendor) {
    res.json(vendor);
  } else {
    res.status(404).json({ message: "Vendor not found" });
  }
});

// @desc    Update vendor profile
// @route   PUT /api/vendor/profile
// @access  Private (Vendor)
const updateVendorProfile = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.vendor._id);

  if (vendor) {
    vendor.businessName = req.body.businessName || vendor.businessName;
    vendor.phone = req.body.phone || vendor.phone;
    vendor.address = req.body.address || vendor.address;

    const updatedVendor = await vendor.save();

    res.json({
      _id: updatedVendor._id,
      businessName: updatedVendor.businessName,
      ownerName: updatedVendor.ownerName,
      email: updatedVendor.email,
      phone: updatedVendor.phone,
      address: updatedVendor.address,
      status: updatedVendor.status,
    });
  } else {
    res.status(404).json({ message: "Vendor not found" });
  }
});

module.exports = {
  registerVendor,
  authVendor,
  getVendorProfile,
  updateVendorProfile,
};
