const express = require("express");
const {
  uploadProductImages,
  deleteProductImage,
} = require("../controllers/uploadController");
const { protectVendor } = require("../middleware/authMiddleware");
const { handleUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

// Upload product images
router.post("/products", protectVendor, handleUpload, uploadProductImages);

// Delete a product image
router.delete("/products/:filename", protectVendor, deleteProductImage);

module.exports = router;
