const asyncHandler = require("express-async-handler");
const Contact = require("../models/Contact");

// @desc    Submit a contact message (public)
// @route   POST /api/contact
// @access  Public
const submitContactMessage = asyncHandler(async (req, res) => {
  const { fullName, email, subject, message } = req.body;

  if (!fullName || !email || !subject || !message) {
    res.status(400);
    throw new Error("Please fill in all fields");
  }

  const contact = await Contact.create({
    fullName,
    email,
    subject,
    message,
  });

  res.status(201).json({
    message: "Your message has been sent successfully. We will get back to you soon!",
    contact: {
      _id: contact._id,
      fullName: contact.fullName,
      email: contact.email,
      subject: contact.subject,
      createdAt: contact.createdAt,
    },
  });
});

// @desc    Get all contact messages
// @route   GET /api/contact
// @access  Private (Admin)
const getAllContactMessages = asyncHandler(async (req, res) => {
  const { status } = req.query;

  let query = {};
  if (status) {
    query.status = status;
  }

  const messages = await Contact.find(query).sort({ createdAt: -1 });

  res.json(messages);
});

// @desc    Get contact message by ID
// @route   GET /api/contact/:id
// @access  Private (Admin)
const getContactMessageById = asyncHandler(async (req, res) => {
  const message = await Contact.findById(req.params.id);

  if (!message) {
    res.status(404);
    throw new Error("Message not found");
  }

  // Mark as read if unread
  if (message.status === "unread") {
    message.status = "read";
    message.readAt = new Date();
    await message.save();
  }

  res.json(message);
});

// @desc    Mark message as resolved
// @route   PATCH /api/contact/:id/resolve
// @access  Private (Admin)
const resolveContactMessage = asyncHandler(async (req, res) => {
  const message = await Contact.findById(req.params.id);

  if (!message) {
    res.status(404);
    throw new Error("Message not found");
  }

  message.status = "resolved";
  message.resolvedAt = new Date();
  message.adminNotes = req.body.notes || null;

  await message.save();

  res.json({
    message: "Message marked as resolved",
    contact: message,
  });
});

// @desc    Delete contact message
// @route   DELETE /api/contact/:id
// @access  Private (Admin)
const deleteContactMessage = asyncHandler(async (req, res) => {
  const message = await Contact.findById(req.params.id);

  if (!message) {
    res.status(404);
    throw new Error("Message not found");
  }

  await message.deleteOne();

  res.json({ message: "Contact message deleted" });
});

// @desc    Get contact stats
// @route   GET /api/contact/stats
// @access  Private (Admin)
const getContactStats = asyncHandler(async (req, res) => {
  const total = await Contact.countDocuments();
  const unread = await Contact.countDocuments({ status: "unread" });
  const read = await Contact.countDocuments({ status: "read" });
  const resolved = await Contact.countDocuments({ status: "resolved" });

  res.json({
    total,
    unread,
    read,
    resolved,
  });
});

module.exports = {
  submitContactMessage,
  getAllContactMessages,
  getContactMessageById,
  resolveContactMessage,
  deleteContactMessage,
  getContactStats,
};
