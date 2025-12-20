const { z } = require("zod");

const vendorRegisterSchema = z.object({
  // Business Information
  businessName: z
    .string({ required_error: "Business name is required" })
    .min(2, "Business name must be at least 2 characters")
    .max(100, "Business name must not exceed 100 characters")
    .trim(),
  category: z
    .string({ required_error: "Category is required" })
    .min(1, "Category is required"),
  panNumber: z
    .string({ required_error: "PAN number is required" })
    .min(9, "PAN number must be at least 9 digits")
    .max(15, "PAN number must not exceed 15 digits"),
  phone: z
    .string({ required_error: "Phone number is required" })
    .min(10, "Phone number must be at least 10 digits")
    .max(15, "Phone number must not exceed 15 digits"),

  // Owner Information
  ownerName: z
    .string({ required_error: "Owner name is required" })
    .min(2, "Owner name must be at least 2 characters")
    .max(100, "Owner name must not exceed 100 characters")
    .trim(),
  email: z
    .string({ required_error: "Email is required" })
    .email("Please provide a valid email address")
    .toLowerCase()
    .trim(),

  // Location
  province: z
    .string({ required_error: "Province is required" })
    .min(1, "Province is required"),
  district: z
    .string({ required_error: "District is required" })
    .min(1, "District is required")
    .trim(),
  address: z
    .string({ required_error: "Address is required" })
    .min(5, "Address must be at least 5 characters")
    .max(200, "Address must not exceed 200 characters")
    .trim(),

  // Security
  password: z
    .string({ required_error: "Password is required" })
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must not exceed 128 characters"),
  confirmPassword: z
    .string({ required_error: "Confirm password is required" })
    .min(1, "Confirm password is required"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const vendorLoginSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Please provide a valid email address")
    .toLowerCase()
    .trim(),
  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Password is required"),
});

module.exports = {
  vendorRegisterSchema,
  vendorLoginSchema,
};
