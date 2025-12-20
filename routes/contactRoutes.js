const express = require("express");
const {
  submitContactMessage,
  getAllContactMessages,
  getContactMessageById,
  resolveContactMessage,
  deleteContactMessage,
  getContactStats,
} = require("../controllers/contactController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// Public route - anyone can submit a contact message
router.post("/", submitContactMessage);

// Protected admin routes
router.get("/", protect, adminOnly, getAllContactMessages);
router.get("/stats", protect, adminOnly, getContactStats);
router.get("/:id", protect, adminOnly, getContactMessageById);
router.patch("/:id/resolve", protect, adminOnly, resolveContactMessage);
router.delete("/:id", protect, adminOnly, deleteContactMessage);

module.exports = router;
