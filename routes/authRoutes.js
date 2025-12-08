const express = require("express");
const { registerSchema, loginSchema } = require("../validators/authValidators");
const validate = require("../middleware/validate");
const { registerUser, authUser } = require("../controllers/authController");
const router = express.Router();

// Public routes for authentication
router.post("/signup", validate(registerSchema), registerUser);
router.post("/login", validate(loginSchema), authUser);

module.exports = router;
