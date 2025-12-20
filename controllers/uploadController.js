const asyncHandler = require("express-async-handler");
const path = require("path");
const fs = require("fs");

// @desc    Upload product images
// @route   POST /api/upload/products
// @access  Private (Vendor)
const uploadProductImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    res.status(400);
    throw new Error("No files uploaded");
  }

  // Create image objects with URLs
  const images = req.files.map((file) => ({
    url: `/uploads/products/${file.filename}`,
    alt: path.parse(file.originalname).name,
  }));

  res.status(200).json({
    message: "Images uploaded successfully",
    images: images,
  });
});

// @desc    Delete a product image
// @route   DELETE /api/upload/products/:filename
// @access  Private (Vendor)
const deleteProductImage = asyncHandler(async (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, "..", "uploads", "products", filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    res.status(404);
    throw new Error("Image not found");
  }

  // Delete the file
  fs.unlinkSync(filePath);

  res.status(200).json({
    message: "Image deleted successfully",
  });
});

module.exports = {
  uploadProductImages,
  deleteProductImage,
};
