const asyncHandler = require("express-async-handler");
const Wishlist = require("../models/Wishlist");
const Product = require("../models/Product");

// @desc    Get user's wishlist
// @route   GET /api/wishlist
// @access  Private
const getWishlist = asyncHandler(async (req, res) => {
  let wishlist = await Wishlist.findOne({ user: req.user._id }).populate({
    path: "products",
    select: "name price comparePrice images rating reviewCount category vendor stock",
    populate: {
      path: "vendor",
      select: "businessName",
    },
  });

  if (!wishlist) {
    wishlist = await Wishlist.create({ user: req.user._id, products: [] });
  }

  res.json(wishlist);
});

// @desc    Add product to wishlist
// @route   POST /api/wishlist
// @access  Private
const addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  let wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist) {
    wishlist = await Wishlist.create({
      user: req.user._id,
      products: [productId],
    });
  } else {
    if (!wishlist.products.includes(productId)) {
      wishlist.products.push(productId);
      await wishlist.save();
    }
  }

  // Populate and return updated wishlist
  wishlist = await Wishlist.findOne({ user: req.user._id }).populate({
    path: "products",
    select: "name price comparePrice images rating reviewCount category vendor stock",
    populate: {
      path: "vendor",
      select: "businessName",
    },
  });

  res.json(wishlist);
});

// @desc    Remove product from wishlist
// @route   DELETE /api/wishlist/:productId
// @access  Private
const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist) {
    res.status(404);
    throw new Error("Wishlist not found");
  }

  wishlist.products = wishlist.products.filter(
    (id) => id.toString() !== productId
  );
  await wishlist.save();

  // Populate and return updated wishlist
  const updatedWishlist = await Wishlist.findOne({ user: req.user._id }).populate({
    path: "products",
    select: "name price comparePrice images rating reviewCount category vendor stock",
    populate: {
      path: "vendor",
      select: "businessName",
    },
  });

  res.json(updatedWishlist);
});

// @desc    Check if product is in wishlist
// @route   GET /api/wishlist/check/:productId
// @access  Private
const checkWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist) {
    return res.json({ isInWishlist: false });
  }

  const isInWishlist = wishlist.products.some(
    (id) => id.toString() === productId
  );

  res.json({ isInWishlist });
});

// @desc    Get wishlist count
// @route   GET /api/wishlist/count
// @access  Private
const getWishlistCount = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id });
  const count = wishlist ? wishlist.products.length : 0;
  res.json({ count });
});

module.exports = {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  checkWishlist,
  getWishlistCount,
};
