const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Helper function to generate a JSON Web Token.
 * @param {string} id - The user ID to include in the payload.
 * @returns {string} The signed JWT.
 */
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// @desc    Register a new user (default role: 'customer')
// @route   POST /api/auth/signup
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, password } = req.body;

  const userExists = await User.findOne({ email });

  if (userExists) {
    // 400 Bad Request
    res
      .status(400)
      .json({ message: "User already exists with this email address." });
    return;
  }

  // Role defaults to 'customer' as set in the User model
  const user = await User.create({
    fullName,
    email,
    password,
  });

  if (user) {
    // 201 Created - Return user details and token
    res.status(201).json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role, // Will be 'customer'
      token: generateToken(user._id),
    });
  } else {
    res.status(400).json({ message: "Invalid user data provided." });
  }
});

// @desc    Authenticate user (Customer or Admin) & get token
// @route   POST /api/auth/login
// @access  Public
const authUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  // Check if user exists AND if the provided password matches the stored hash
  if (user && (await user.matchPassword(password))) {
    res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role, // <-- CRUCIAL: Returns 'customer' or 'admin'
      token: generateToken(user._id),
    });
  } else {
    // 401 Unauthorized
    res.status(401).json({ message: "Invalid email or password." });
  }
});

module.exports = { registerUser, authUser };
