const sendEmail = require("../utils/sendEmail");
const {
  generateOTPEmail,
  generateVerificationEmail,
  generateWelcomeEmail,
} = require("../templates/emailTemplates");

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

module.exports = {
  sendOTPEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
};
