const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const Order = require("../models/Order");

// eSewa Configuration
const ESEWA_CONFIG = {
  merchantCode: process.env.ESEWA_MERCHANT_CODE,
  secretKey: process.env.ESEWA_SECRET_KEY,
  paymentUrl: process.env.ESEWA_PAYMENT_URL,
  verifyUrl: process.env.ESEWA_VERIFY_URL,
};

// Generate HMAC SHA256 signature for eSewa
const generateSignature = (message) => {
  const hmac = crypto.createHmac("sha256", ESEWA_CONFIG.secretKey);
  hmac.update(message);
  return hmac.digest("base64");
};

// @desc    Initiate eSewa payment
// @route   POST /api/payment/esewa/initiate
// @access  Private
const initiateEsewaPayment = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  // Find the order
  const order = await Order.findOne({
    _id: orderId,
    user: req.user._id,
  });

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (order.paymentStatus === "paid") {
    res.status(400);
    throw new Error("Order already paid");
  }

  if (order.paymentMethod !== "esewa") {
    res.status(400);
    throw new Error("Invalid payment method for this order");
  }

  // Generate unique transaction UUID
  const transactionUuid = `${order.orderNumber}-${Date.now()}`;

  // Save transaction UUID to order for later verification
  order.transactionUuid = transactionUuid;
  await order.save();

  // eSewa requires: total_amount = amount + tax_amount + product_service_charge + product_delivery_charge
  const amount = order.subtotal; // Base product amount
  const taxAmount = order.tax;
  const serviceCharge = 0;
  const deliveryCharge = order.shippingCost;
  const totalAmount = amount + taxAmount + serviceCharge + deliveryCharge;

  // Prepare signature message
  // Format: total_amount=X,transaction_uuid=Y,product_code=Z
  const signatureMessage = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${ESEWA_CONFIG.merchantCode}`;
  const signature = generateSignature(signatureMessage);

  // Prepare payment data for frontend to submit to eSewa
  const paymentData = {
    amount: amount.toString(),
    tax_amount: taxAmount.toString(),
    total_amount: totalAmount.toString(),
    transaction_uuid: transactionUuid,
    product_code: ESEWA_CONFIG.merchantCode,
    product_service_charge: serviceCharge.toString(),
    product_delivery_charge: deliveryCharge.toString(),
    success_url: `${process.env.FRONTEND_URL}/payment/success`,
    failure_url: `${process.env.FRONTEND_URL}/payment/failure`,
    signed_field_names: "total_amount,transaction_uuid,product_code",
    signature: signature,
  };

  res.json({
    success: true,
    paymentUrl: ESEWA_CONFIG.paymentUrl,
    paymentData,
  });
});

// @desc    Verify eSewa payment
// @route   POST /api/payment/esewa/verify
// @access  Private
const verifyEsewaPayment = asyncHandler(async (req, res) => {
  const { encodedData } = req.body;

  if (!encodedData) {
    res.status(400);
    throw new Error("No payment data provided");
  }

  // Decode the base64 encoded response from eSewa
  let decodedData;
  try {
    const decodedString = Buffer.from(encodedData, "base64").toString("utf-8");
    decodedData = JSON.parse(decodedString);
  } catch (error) {
    res.status(400);
    throw new Error("Invalid payment data");
  }

  const {
    transaction_uuid,
    total_amount,
    transaction_code,
    status,
    signed_field_names,
    signature,
  } = decodedData;

  // Verify the signature
  const signatureMessage = signed_field_names
    .split(",")
    .map((field) => `${field}=${decodedData[field]}`)
    .join(",");

  const expectedSignature = generateSignature(signatureMessage);

  if (signature !== expectedSignature) {
    res.status(400);
    throw new Error("Invalid payment signature");
  }

  // Find order by transaction UUID
  const order = await Order.findOne({ transactionUuid: transaction_uuid });

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Check if already processed
  if (order.paymentStatus === "paid") {
    return res.json({
      success: true,
      message: "Payment already verified",
      order,
    });
  }

  // Verify status and amount
  if (status !== "COMPLETE") {
    order.paymentStatus = "failed";
    await order.save();
    res.status(400);
    throw new Error("Payment was not successful");
  }

  // Verify amount matches
  if (parseFloat(total_amount) !== order.total) {
    order.paymentStatus = "failed";
    await order.save();
    res.status(400);
    throw new Error("Payment amount mismatch");
  }

  // Update order payment status
  order.paymentStatus = "paid";
  order.transactionCode = transaction_code;
  order.orderStatus = "confirmed";
  await order.save();

  res.json({
    success: true,
    message: "Payment verified successfully",
    order,
  });
});

// @desc    Handle eSewa payment failure
// @route   POST /api/payment/esewa/failure
// @access  Private
const handleEsewaFailure = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (orderId) {
    const order = await Order.findOne({
      _id: orderId,
      user: req.user._id,
    });

    if (order && order.paymentStatus !== "paid") {
      order.paymentStatus = "failed";
      await order.save();
    }
  }

  res.json({
    success: false,
    message: "Payment failed or cancelled",
  });
});

// @desc    Get payment status
// @route   GET /api/payment/status/:orderId
// @access  Private
const getPaymentStatus = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.orderId,
    user: req.user._id,
  });

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  res.json({
    orderId: order._id,
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    total: order.total,
  });
});

module.exports = {
  initiateEsewaPayment,
  verifyEsewaPayment,
  handleEsewaFailure,
  getPaymentStatus,
};
