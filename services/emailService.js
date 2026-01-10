const sendEmail = require("../utils/sendEmail");
const {
  generateOTPEmail,
  generateVerificationEmail,
  generateWelcomeEmail,
} = require("../templates/emailTemplates");
const Settings = require("../models/Settings");

const sendOTPEmail = async (email, otp) => {
  const html = generateOTPEmail(otp);
  await sendEmail(email, "Password Reset OTP - MeroBazaar", html);
};

const sendVerificationEmail = async (email, name, code) => {
  const html = generateVerificationEmail(name, code);
  await sendEmail(email, "Verify Your Email - MeroBazaar", html);
};

const sendWelcomeEmail = async (email, name) => {
  const html = generateWelcomeEmail(name);
  await sendEmail(email, "Welcome to MeroBazaar!", html);
};

// Helper to get admin email and check notification settings
const getAdminNotificationSettings = async () => {
  const settings = await Settings.findOne({ key: "admin_settings" });
  return settings;
};

// Admin notification: New Order
const sendNewOrderNotification = async (order) => {
  try {
    const settings = await getAdminNotificationSettings();
    if (!settings?.notifications?.emailOnNewOrder || !settings?.adminEmail)
      return;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #10B981; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">New Order Received!</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <h2 style="color: #333;">Order #${order._id
            .toString()
            .slice(-8)
            .toUpperCase()}</h2>
          <p><strong>Customer:</strong> ${
            order.shippingAddress?.fullName || "N/A"
          }</p>
          <p><strong>Email:</strong> ${
            order.shippingAddress?.email || "N/A"
          }</p>
          <p><strong>Total Amount:</strong> Rs. ${order.total?.toLocaleString()}</p>
          <p><strong>Items:</strong> ${order.items?.length || 0} items</p>
          <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 14px;">
            Login to your admin dashboard to view and manage this order.
          </p>
        </div>
      </div>
    `;

    await sendEmail(
      settings.adminEmail,
      "New Order Received - MeroBazaar",
      html
    );
  } catch (error) {
    console.error("Failed to send new order notification:", error);
  }
};

// Admin notification: New Vendor Registration
const sendNewVendorNotification = async (vendor) => {
  try {
    const settings = await getAdminNotificationSettings();
    if (!settings?.notifications?.emailOnNewVendor || !settings?.adminEmail)
      return;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #3B82F6; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">New Vendor Application</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <h2 style="color: #333;">${vendor.businessName}</h2>
          <p><strong>Owner:</strong> ${vendor.ownerName}</p>
          <p><strong>Email:</strong> ${vendor.email}</p>
          <p><strong>Phone:</strong> ${vendor.phone || "N/A"}</p>
          <p><strong>Province:</strong> ${vendor.province || "N/A"}</p>
          <p><strong>Business Type:</strong> ${vendor.businessType || "N/A"}</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 14px;">
            Login to your admin dashboard to review and approve/reject this application.
          </p>
        </div>
      </div>
    `;

    await sendEmail(
      settings.adminEmail,
      "New Vendor Application - MeroBazaar",
      html
    );
  } catch (error) {
    console.error("Failed to send new vendor notification:", error);
  }
};

// Admin notification: New Customer Registration
const sendNewCustomerNotification = async (customer) => {
  try {
    const settings = await getAdminNotificationSettings();
    if (!settings?.notifications?.emailOnNewCustomer || !settings?.adminEmail)
      return;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #8B5CF6; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">New Customer Registration</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <h2 style="color: #333;">${customer.fullName}</h2>
          <p><strong>Email:</strong> ${customer.email}</p>
          <p><strong>Joined:</strong> ${new Date().toLocaleDateString()}</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 14px;">
            A new customer has registered on MeroBazaar.
          </p>
        </div>
      </div>
    `;

    await sendEmail(
      settings.adminEmail,
      "New Customer Registration - MeroBazaar",
      html
    );
  } catch (error) {
    console.error("Failed to send new customer notification:", error);
  }
};

// Admin notification: Low Stock Alert
const sendLowStockNotification = async (product, currentStock) => {
  try {
    const settings = await getAdminNotificationSettings();
    if (!settings?.notifications?.emailOnLowStock || !settings?.adminEmail)
      return;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #F59E0B; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Low Stock Alert!</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <h2 style="color: #333;">${product.name}</h2>
          <p><strong>Current Stock:</strong> <span style="color: #EF4444; font-weight: bold;">${currentStock} units</span></p>
          <p><strong>SKU:</strong> ${product.sku || "N/A"}</p>
          <p><strong>Vendor:</strong> ${
            product.vendor?.businessName || "N/A"
          }</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 14px;">
            Please restock this product soon to avoid stockouts.
          </p>
        </div>
      </div>
    `;

    await sendEmail(settings.adminEmail, "Low Stock Alert - MeroBazaar", html);
  } catch (error) {
    console.error("Failed to send low stock notification:", error);
  }
};

// Admin notification: Contact Form Message
const sendContactMessageNotification = async (contact) => {
  try {
    const settings = await getAdminNotificationSettings();
    if (
      !settings?.notifications?.emailOnContactMessage ||
      !settings?.adminEmail
    )
      return;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #6366F1; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">New Contact Message</h1>
        </div>
        <div style="padding: 20px; background: #f9f9f9;">
          <h2 style="color: #333;">${contact.subject || "No Subject"}</h2>
          <p><strong>From:</strong> ${contact.name}</p>
          <p><strong>Email:</strong> ${contact.email}</p>
          <p><strong>Phone:</strong> ${contact.phone || "N/A"}</p>
          <div style="background: white; padding: 15px; border-radius: 8px; margin-top: 10px;">
            <p style="color: #333; margin: 0;">${contact.message}</p>
          </div>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 14px;">
            Login to your admin dashboard to respond to this message.
          </p>
        </div>
      </div>
    `;

    await sendEmail(
      settings.adminEmail,
      `New Contact: ${contact.subject || "Message"} - MeroBazaar`,
      html
    );
  } catch (error) {
    console.error("Failed to send contact message notification:", error);
  }
};

module.exports = {
  sendOTPEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendNewOrderNotification,
  sendNewVendorNotification,
  sendNewCustomerNotification,
  sendLowStockNotification,
  sendContactMessageNotification,
};
