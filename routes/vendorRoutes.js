const express = require("express");
const {
  registerVendor,
  authVendor,
  getVendorProfile,
  updateVendorProfile,
} = require("../controllers/vendorController");
const validate = require("../middleware/validate");
const { vendorRegisterSchema, vendorLoginSchema } = require("../validators/vendorValidators");
const { protectVendor } = require("../middleware/authMiddleware");

const router = express.Router();

// Public vendor auth routes
router.post("/auth/register", validate(vendorRegisterSchema), registerVendor);
router.post("/auth/login", validate(vendorLoginSchema), authVendor);

// Protected vendor routes
router.get("/profile", protectVendor, getVendorProfile);
router.put("/profile", protectVendor, updateVendorProfile);

module.exports = router;
