const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["customer", "admin"],
    default: "customer",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Method to compare entered password with hashed password in DB
UserSchema.methods.matchPassword = async function (enteredPassword) {
  // 'this.password' is the hashed password from the DB
  return await bcrypt.compare(enteredPassword, this.password);
};

// Middleware: Hash password before saving (runs on signup)
// FIX: Removed 'next' argument and the 'next()' call for an async hook.
UserSchema.pre("save", async function () {
  // Only run if the password field is actually modified
  if (!this.isModified("password")) {
    return; // Use 'return' instead of 'return next()'
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  // Mongoose automatically continues when this async function completes.
});

const User = mongoose.model("User", UserSchema);

module.exports = User;
