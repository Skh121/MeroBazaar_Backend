const generateOTPEmail = (otp) => {
  return `
    <div style="font-family: 'Inter', 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f4; padding: 40px 20px; margin: 0;">
      <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.08); text-align: center; padding: 0 32px;">

        <!-- Logo -->
        <div style="padding: 32px 0;">
          <img src="https://merobazaar.com/logo.png" alt="MeroBazaar Logo" width="60" style="margin-bottom: 16px;">
        </div>

        <!-- Heading -->
        <h2 style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0 0 12px;">
          Password Reset Request
        </h2>

        <p style="font-size: 16px; color: #4b5563; margin: 0 0 28px; line-height: 1.6;">
          We received a request to reset your password. Use the OTP code below to proceed with resetting your password.
        </p>

        <!-- OTP Code -->
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #111827; background-color: #f3f4f6; padding: 18px 30px; border-radius: 12px; display: inline-block; margin-bottom: 28px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
          ${otp}
        </div>

        <!-- Instructions -->
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 32px; line-height: 1.5;">
          This code will expire in <strong>10 minutes</strong>. If you did not request a password reset, please ignore this email.
        </p>

        <!-- Footer -->
        <div style="padding: 24px; background-color: #f9fafb; font-size: 12px; color: #9ca3af;">
          <p style="margin: 0;">&copy; ${new Date().getFullYear()} MeroBazaar. All rights reserved.</p>
          <p style="margin: 4px 0 0;">
            Need help?
            <a href="mailto:support@merobazaar.com" style="color: #1f2937; text-decoration: underline;">
              Contact Support
            </a>
          </p>
        </div>

      </div>
    </div>
  `;
};

const generateVerificationEmail = (name, code) => {
  return `
    <div style="font-family: 'Inter', 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f4; padding: 40px 20px; margin: 0;">
      <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.08); text-align: center; padding: 0 32px;">

        <!-- Logo -->
        <div style="padding: 32px 0;">
          <img src="https://merobazaar.com/logo.png" alt="MeroBazaar Logo" width="60" style="margin-bottom: 16px;">
        </div>

        <!-- Greeting -->
        <h2 style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0 0 12px;">
          Hello ${name},
        </h2>

        <p style="font-size: 16px; color: #4b5563; margin: 0 0 28px; line-height: 1.6;">
          Thank you for creating a MeroBazaar account! To get started, please verify your email address using the code below.
        </p>

        <!-- Verification Code -->
        <div style="font-size: 28px; font-weight: 700; letter-spacing: 3px; color: #111827; background-color: #f3f4f6; padding: 18px 30px; border-radius: 12px; display: inline-block; margin-bottom: 28px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
          ${code}
        </div>

        <!-- Optional instructions -->
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 32px; line-height: 1.5;">
          If you did not request this email, please ignore it. The code will expire in 15 minutes.
        </p>

        <!-- Footer -->
        <div style="padding: 24px; background-color: #f9fafb; font-size: 12px; color: #9ca3af;">
          <p style="margin: 0;">&copy; ${new Date().getFullYear()} MeroBazaar. All rights reserved.</p>
          <p style="margin: 4px 0 0;">
            Need help?
            <a href="mailto:support@merobazaar.com" style="color: #1f2937; text-decoration: underline;">
              Contact Support
            </a>
          </p>
        </div>

      </div>
    </div>
  `;
};

const generateWelcomeEmail = (name) => {
  return `
    <div style="font-family: 'Inter', 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f4; padding: 40px 20px; margin: 0;">
      <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.08); text-align: center; padding: 0 32px;">

        <!-- Logo -->
        <div style="padding: 32px 0;">
          <img src="https://merobazaar.com/logo.png" alt="MeroBazaar Logo" width="60" style="margin-bottom: 16px;">
        </div>

        <!-- Greeting -->
        <h2 style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0 0 12px;">
          Welcome to MeroBazaar, ${name}!
        </h2>

        <p style="font-size: 16px; color: #4b5563; margin: 0 0 28px; line-height: 1.6;">
          We're excited to have you on board. Start exploring our wide range of products and enjoy a seamless shopping experience.
        </p>

        <!-- CTA Button -->
        <a href="https://merobazaar.com" style="display: inline-block; background-color: #1f2937; color: #ffffff; font-size: 16px; font-weight: 600; padding: 14px 32px; border-radius: 8px; text-decoration: none; margin-bottom: 28px;">
          Start Shopping
        </a>

        <!-- Footer -->
        <div style="padding: 24px; background-color: #f9fafb; font-size: 12px; color: #9ca3af;">
          <p style="margin: 0;">&copy; ${new Date().getFullYear()} MeroBazaar. All rights reserved.</p>
          <p style="margin: 4px 0 0;">
            Need help?
            <a href="mailto:support@merobazaar.com" style="color: #1f2937; text-decoration: underline;">
              Contact Support
            </a>
          </p>
        </div>

      </div>
    </div>
  `;
};

module.exports = {
  generateOTPEmail,
  generateVerificationEmail,
  generateWelcomeEmail,
};
