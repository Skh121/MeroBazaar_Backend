const express = require("express");
const {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  checkWishlist,
  getWishlistCount,
} = require("../controllers/wishlistController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getWishlist);
router.get("/count", protect, getWishlistCount);
router.get("/check/:productId", protect, checkWishlist);
router.post("/", protect, addToWishlist);
router.delete("/:productId", protect, removeFromWishlist);

module.exports = router;
