const asyncHandler = require("express-async-handler");
const Cart = require("../models/Cart");
const Product = require("../models/Product");

// @desc    Get user's cart
// @route   GET /api/cart
// @access  Private
const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id }).populate({
    path: "items.product",
    select: "name price images stock vendor category",
    populate: {
      path: "vendor",
      select: "businessName",
    },
  });

  if (!cart) {
    cart = await Cart.create({ user: req.user._id, items: [] });
  }

  res.json(cart);
});

// @desc    Add item to cart
// @route   POST /api/cart/add
// @access  Private
const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  if (product.stock < quantity) {
    res.status(400);
    throw new Error("Not enough stock available");
  }

  let cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    cart = await Cart.create({
      user: req.user._id,
      items: [{ product: productId, quantity, price: product.price }],
    });
  } else {
    const existingItem = cart.items.find(
      (item) => item.product.toString() === productId
    );

    if (existingItem) {
      existingItem.quantity += quantity;
      if (existingItem.quantity > product.stock) {
        existingItem.quantity = product.stock;
      }
    } else {
      cart.items.push({ product: productId, quantity, price: product.price });
    }

    await cart.save();
  }

  // Populate and return updated cart
  cart = await Cart.findOne({ user: req.user._id }).populate({
    path: "items.product",
    select: "name price images stock vendor category",
    populate: {
      path: "vendor",
      select: "businessName",
    },
  });

  res.json(cart);
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/update
// @access  Private
const updateCartItem = asyncHandler(async (req, res) => {
  const { productId, quantity } = req.body;

  const cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    res.status(404);
    throw new Error("Cart not found");
  }

  const item = cart.items.find((item) => item.product.toString() === productId);

  if (!item) {
    res.status(404);
    throw new Error("Item not found in cart");
  }

  const product = await Product.findById(productId);
  if (quantity > product.stock) {
    res.status(400);
    throw new Error("Not enough stock available");
  }

  if (quantity <= 0) {
    cart.items = cart.items.filter((item) => item.product.toString() !== productId);
  } else {
    item.quantity = quantity;
  }

  await cart.save();

  // Populate and return updated cart
  const updatedCart = await Cart.findOne({ user: req.user._id }).populate({
    path: "items.product",
    select: "name price images stock vendor category",
    populate: {
      path: "vendor",
      select: "businessName",
    },
  });

  res.json(updatedCart);
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/remove/:productId
// @access  Private
const removeFromCart = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    res.status(404);
    throw new Error("Cart not found");
  }

  cart.items = cart.items.filter((item) => item.product.toString() !== productId);
  await cart.save();

  // Populate and return updated cart
  const updatedCart = await Cart.findOne({ user: req.user._id }).populate({
    path: "items.product",
    select: "name price images stock vendor category",
    populate: {
      path: "vendor",
      select: "businessName",
    },
  });

  res.json(updatedCart);
});

// @desc    Clear cart
// @route   DELETE /api/cart/clear
// @access  Private
const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });

  if (cart) {
    cart.items = [];
    await cart.save();
  }

  res.json({ message: "Cart cleared", items: [] });
});

// @desc    Get cart count
// @route   GET /api/cart/count
// @access  Private
const getCartCount = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  const count = cart ? cart.items.reduce((total, item) => total + item.quantity, 0) : 0;
  res.json({ count });
});

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  getCartCount,
};
