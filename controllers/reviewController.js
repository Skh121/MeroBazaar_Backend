const asyncHandler = require("express-async-handler");
const Review = require("../models/Review");
const Product = require("../models/Product");

// @desc    Get reviews for a product
// @route   GET /api/products/:id/reviews
// @access  Public
const getProductReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const productId = req.params.id;

  const reviews = await Review.find({ product: productId })
    .populate("user", "fullName")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Review.countDocuments({ product: productId });

  res.json({
    reviews,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Create a review for a product
// @route   POST /api/products/:id/reviews
// @access  Private (User)
const createReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const productId = req.params.id;

  // Check if product exists
  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  // Check if user already reviewed this product
  const existingReview = await Review.findOne({
    product: productId,
    user: req.user._id,
  });

  if (existingReview) {
    res.status(400);
    throw new Error("You have already reviewed this product");
  }

  // Create review
  const review = await Review.create({
    product: productId,
    user: req.user._id,
    rating,
    comment,
  });

  // Update product rating and review count
  const allReviews = await Review.find({ product: productId });
  const avgRating =
    allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

  product.rating = Math.round(avgRating * 10) / 10; // Round to 1 decimal
  product.reviewCount = allReviews.length;
  await product.save();

  // Populate user info for response
  await review.populate("user", "fullName");

  res.status(201).json(review);
});

// @desc    Update a review
// @route   PUT /api/products/:id/reviews/:reviewId
// @access  Private (User - own review only)
const updateReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const { id: productId, reviewId } = req.params;

  const review = await Review.findOne({
    _id: reviewId,
    product: productId,
    user: req.user._id,
  });

  if (!review) {
    res.status(404);
    throw new Error("Review not found or not authorized");
  }

  review.rating = rating || review.rating;
  review.comment = comment || review.comment;
  await review.save();

  // Update product rating
  const allReviews = await Review.find({ product: productId });
  const avgRating =
    allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

  const product = await Product.findById(productId);
  product.rating = Math.round(avgRating * 10) / 10;
  await product.save();

  await review.populate("user", "fullName");

  res.json(review);
});

// @desc    Delete a review
// @route   DELETE /api/products/:id/reviews/:reviewId
// @access  Private (User - own review only)
const deleteReview = asyncHandler(async (req, res) => {
  const { id: productId, reviewId } = req.params;

  const review = await Review.findOne({
    _id: reviewId,
    product: productId,
    user: req.user._id,
  });

  if (!review) {
    res.status(404);
    throw new Error("Review not found or not authorized");
  }

  await review.deleteOne();

  // Update product rating and review count
  const allReviews = await Review.find({ product: productId });
  const product = await Product.findById(productId);

  if (allReviews.length > 0) {
    const avgRating =
      allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
    product.rating = Math.round(avgRating * 10) / 10;
  } else {
    product.rating = 0;
  }
  product.reviewCount = allReviews.length;
  await product.save();

  res.json({ message: "Review deleted successfully" });
});

// @desc    Mark a review as helpful
// @route   POST /api/products/:id/reviews/:reviewId/helpful
// @access  Public
const markReviewHelpful = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;

  const review = await Review.findById(reviewId);

  if (!review) {
    res.status(404);
    throw new Error("Review not found");
  }

  review.helpful += 1;
  await review.save();

  res.json({ helpful: review.helpful });
});

module.exports = {
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
  markReviewHelpful,
};
