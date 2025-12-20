const asyncHandler = require("express-async-handler");
const Product = require("../models/Product");

// ============ VENDOR OPERATIONS ============

// @desc    Create a new product
// @route   POST /api/products
// @access  Private (Vendor)
const createProduct = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    price,
    comparePrice,
    category,
    images,
    stock,
    unit,
    isFeatured,
    isRegionalSpecialty,
    badge,
    tags,
  } = req.body;

  // Check if vendor is approved
  if (req.vendor.status !== "approved") {
    res.status(403);
    throw new Error("Your vendor account is not approved yet");
  }

  const product = await Product.create({
    name,
    description,
    price,
    comparePrice,
    category,
    images: images || [],
    vendor: req.vendor._id,
    stock,
    unit,
    isFeatured,
    isRegionalSpecialty,
    badge,
    tags,
  });

  res.status(201).json(product);
});

// @desc    Get all products for a vendor
// @route   GET /api/products/vendor
// @access  Private (Vendor)
const getVendorProducts = asyncHandler(async (req, res) => {
  const { status, category, page = 1, limit = 10 } = req.query;

  let query = { vendor: req.vendor._id };

  if (status) {
    query.status = status;
  }
  if (category) {
    query.category = category;
  }

  const products = await Product.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Product.countDocuments(query);

  res.json({
    products,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private (Vendor)
const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    vendor: req.vendor._id,
  });

  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  const {
    name,
    description,
    price,
    comparePrice,
    category,
    images,
    stock,
    unit,
    isFeatured,
    isRegionalSpecialty,
    badge,
    status,
    tags,
  } = req.body;

  product.name = name || product.name;
  product.description = description || product.description;
  product.price = price !== undefined ? price : product.price;
  product.comparePrice = comparePrice !== undefined ? comparePrice : product.comparePrice;
  product.category = category || product.category;
  product.images = images || product.images;
  product.stock = stock !== undefined ? stock : product.stock;
  product.unit = unit || product.unit;
  product.isFeatured = isFeatured !== undefined ? isFeatured : product.isFeatured;
  product.isRegionalSpecialty = isRegionalSpecialty !== undefined ? isRegionalSpecialty : product.isRegionalSpecialty;
  product.badge = badge !== undefined ? badge : product.badge;
  product.status = status || product.status;
  product.tags = tags || product.tags;

  // Auto-update status if out of stock
  if (product.stock === 0) {
    product.status = "out_of_stock";
  } else if (product.status === "out_of_stock" && product.stock > 0) {
    product.status = "active";
  }

  const updatedProduct = await product.save();

  res.json(updatedProduct);
});

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private (Vendor)
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    vendor: req.vendor._id,
  });

  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  await product.deleteOne();

  res.json({ message: "Product deleted successfully" });
});

// @desc    Get single product for vendor
// @route   GET /api/products/vendor/:id
// @access  Private (Vendor)
const getVendorProductById = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    vendor: req.vendor._id,
  });

  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  res.json(product);
});

// ============ PUBLIC OPERATIONS ============

// @desc    Get all active products (public)
// @route   GET /api/products
// @access  Public
const getAllProducts = asyncHandler(async (req, res) => {
  const { category, search, page = 1, limit = 12, sort = "createdAt" } = req.query;

  let query = { status: "active" };

  if (category) {
    query.category = category;
  }

  if (search) {
    query.$text = { $search: search };
  }

  let sortOption = {};
  switch (sort) {
    case "price_low":
      sortOption = { price: 1 };
      break;
    case "price_high":
      sortOption = { price: -1 };
      break;
    case "rating":
      sortOption = { rating: -1 };
      break;
    case "newest":
    default:
      sortOption = { createdAt: -1 };
  }

  const products = await Product.find(query)
    .populate("vendor", "businessName district province")
    .sort(sortOption)
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Product.countDocuments(query);

  res.json({
    products,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Get featured products (for landing page)
// @route   GET /api/products/featured
// @access  Public
const getFeaturedProducts = asyncHandler(async (req, res) => {
  const { limit = 8 } = req.query;

  const products = await Product.find({ status: "active", isFeatured: true })
    .populate("vendor", "businessName district province")
    .sort({ createdAt: -1 })
    .limit(parseInt(limit));

  // If not enough featured, fill with recent products
  if (products.length < limit) {
    const remaining = parseInt(limit) - products.length;
    const existingIds = products.map((p) => p._id);

    const moreProducts = await Product.find({
      status: "active",
      _id: { $nin: existingIds },
    })
      .populate("vendor", "businessName district province")
      .sort({ rating: -1, reviewCount: -1 })
      .limit(remaining);

    products.push(...moreProducts);
  }

  res.json(products);
});

// @desc    Get regional specialty products (for landing page)
// @route   GET /api/products/regional
// @access  Public
const getRegionalProducts = asyncHandler(async (req, res) => {
  const { limit = 4, province } = req.query;

  let query = { status: "active", isRegionalSpecialty: true };

  if (province) {
    query["vendor.province"] = province;
  }

  const products = await Product.find(query)
    .populate("vendor", "businessName district province")
    .sort({ createdAt: -1 })
    .limit(parseInt(limit));

  // If not enough regional specialty products, get products from different provinces
  if (products.length < limit) {
    const remaining = parseInt(limit) - products.length;
    const existingIds = products.map((p) => p._id);

    const moreProducts = await Product.find({
      status: "active",
      _id: { $nin: existingIds },
    })
      .populate("vendor", "businessName district province")
      .sort({ createdAt: -1 })
      .limit(remaining);

    products.push(...moreProducts);
  }

  res.json(products);
});

// @desc    Get single product by ID (public)
// @route   GET /api/products/:id
// @access  Public
const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    status: "active",
  }).populate("vendor", "businessName ownerName district province phone email");

  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  res.json(product);
});

// @desc    Get products by category (public)
// @route   GET /api/products/category/:category
// @access  Public
const getProductsByCategory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 12 } = req.query;
  const category = decodeURIComponent(req.params.category);

  const products = await Product.find({ status: "active", category })
    .populate("vendor", "businessName district province")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Product.countDocuments({ status: "active", category });

  res.json({
    products,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

module.exports = {
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
};
