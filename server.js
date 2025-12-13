const express = require("express");
require("dotenv").config();
const cors = require("cors");
const morgan = require("morgan");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(cors()); // Allows cross-origin requests from the frontend
app.use(express.json()); // Body parser for JSON data
app.use(morgan("dev")); // HTTP request logger

// API Routes
app.use("/api/auth", authRoutes);

// Simple welcome route
app.get("/", (req, res) => {
  res.send("MeroBazaar API is running...");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
