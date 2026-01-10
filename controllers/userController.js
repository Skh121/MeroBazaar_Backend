const asyncHandler = require("express-async-handler");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "-password -otp -otpExpiry"
  );

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.json(user);
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const { fullName, phone, dateOfBirth, gender, avatar } = req.body;

  user.fullName = fullName || user.fullName;
  user.phone = phone !== undefined ? phone : user.phone;
  user.dateOfBirth = dateOfBirth || user.dateOfBirth;
  user.gender = gender !== undefined ? gender : user.gender;
  user.avatar = avatar !== undefined ? avatar : user.avatar;

  const updatedUser = await user.save();

  res.json({
    _id: updatedUser._id,
    fullName: updatedUser.fullName,
    email: updatedUser.email,
    phone: updatedUser.phone,
    dateOfBirth: updatedUser.dateOfBirth,
    gender: updatedUser.gender,
    avatar: updatedUser.avatar,
    addresses: updatedUser.addresses,
    role: updatedUser.role,
    createdAt: updatedUser.createdAt,
  });
});

// @desc    Change user password
// @route   PUT /api/users/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const { currentPassword, newPassword } = req.body;

  // Check current password
  const isMatch = await user.matchPassword(currentPassword);
  if (!isMatch) {
    res.status(400);
    throw new Error("Current password is incorrect");
  }

  // Validate new password
  if (!newPassword || newPassword.length < 6) {
    res.status(400);
    throw new Error("New password must be at least 6 characters");
  }

  user.password = newPassword;
  await user.save();

  res.json({ message: "Password updated successfully" });
});

// @desc    Add a new address
// @route   POST /api/users/addresses
// @access  Private
const addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const { label, street, city, district, province, isDefault } = req.body;

  // If new address is default, unset other defaults
  if (isDefault) {
    user.addresses.forEach((addr) => {
      addr.isDefault = false;
    });
  }

  user.addresses.push({
    label,
    street,
    city,
    district,
    province,
    isDefault: isDefault || user.addresses.length === 0, // First address is default
  });

  await user.save();

  res.status(201).json(user.addresses);
});

// @desc    Update an address
// @route   PUT /api/users/addresses/:addressId
// @access  Private
const updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const address = user.addresses.id(req.params.addressId);

  if (!address) {
    res.status(404);
    throw new Error("Address not found");
  }

  const { label, street, city, district, province, isDefault } = req.body;

  // If this address becomes default, unset other defaults
  if (isDefault && !address.isDefault) {
    user.addresses.forEach((addr) => {
      addr.isDefault = false;
    });
  }

  address.label = label || address.label;
  address.street = street || address.street;
  address.city = city || address.city;
  address.district = district || address.district;
  address.province = province || address.province;
  address.isDefault = isDefault !== undefined ? isDefault : address.isDefault;

  await user.save();

  res.json(user.addresses);
});

// @desc    Delete an address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const addressIndex = user.addresses.findIndex(
    (addr) => addr._id.toString() === req.params.addressId
  );

  if (addressIndex === -1) {
    res.status(404);
    throw new Error("Address not found");
  }

  const wasDefault = user.addresses[addressIndex].isDefault;
  user.addresses.splice(addressIndex, 1);

  // If deleted address was default, set first remaining as default
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save();

  res.json({ message: "Address deleted", addresses: user.addresses });
});

// @desc    Get all addresses
// @route   GET /api/users/addresses
// @access  Private
const getAddresses = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("addresses");

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.json(user.addresses);
});

// @desc    Upload user avatar
// @route   POST /api/users/avatar
// @access  Private
const uploadAvatar = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (!req.file) {
    res.status(400);
    throw new Error("No file uploaded");
  }

  // Delete old avatar if it exists and is a local file
  if (user.avatar && user.avatar.includes("/uploads/avatars/")) {
    const oldAvatarPath = path.join(
      __dirname,
      "..",
      user.avatar.replace(/^\//, "")
    );
    if (fs.existsSync(oldAvatarPath)) {
      fs.unlinkSync(oldAvatarPath);
    }
  }

  // Set new avatar URL
  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  user.avatar = avatarUrl;
  await user.save();

  res.json({
    message: "Avatar uploaded successfully",
    avatar: avatarUrl,
  });
});

module.exports = {
  getUserProfile,
  updateUserProfile,
  changePassword,
  addAddress,
  updateAddress,
  deleteAddress,
  getAddresses,
  uploadAvatar,
};
