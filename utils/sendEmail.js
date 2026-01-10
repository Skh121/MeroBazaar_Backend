const nodemailer = require("nodemailer");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// Verify transporter on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("Email transporter verification failed:", error.message);
  } else {
    console.log("Email transporter is ready to send messages");
  }
});

const sendEmail = async (to, subject, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"MeroBazaar" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log("Email sent successfully to:", to);
    console.log("Message ID:", info.messageId);
    return info;
  } catch (error) {
    console.error("Failed to send email to:", to);
    console.error("Error:", error.message);
    throw error;
  }
};

module.exports = sendEmail;
