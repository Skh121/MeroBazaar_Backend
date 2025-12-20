const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [100, "Product name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Product description is required"],
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    price: {
      type: Number,
      required: [true, "Product price is required"],
      min: [0, "Price cannot be negative"],
    },
    comparePrice: {
      type: Number,
      default: null,
    },
    category: {
      type: String,
      required: [true, "Product category is required"],
      enum: [
        "Food & Spices",
        "Textiles",
        "Handicrafts",
        "Agriculture",
        "Dairy & Cheese",
        "Others",
      ],
    },
    images: [
      {
        url: {
          type: String,
          required: true,
        },
        alt: {
          type: String,
          default: "",
        },
      },
    ],
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    stock: {
      type: Number,
      required: [true, "Stock quantity is required"],
      min: [0, "Stock cannot be negative"],
      default: 0,
    },
    unit: {
      type: String,
      default: "piece",
      enum: ["piece", "kg", "gram", "liter", "ml", "dozen", "pack"],
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isRegionalSpecialty: {
      type: Boolean,
      default: false,
    },
    badge: {
      type: String,
      enum: ["Best Seller", "New", "Sale", "Limited", null],
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "out_of_stock"],
      default: "active",
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Virtual for vendor details populated
productSchema.virtual("vendorDetails", {
  ref: "Vendor",
  localField: "vendor",
  foreignField: "_id",
  justOne: true,
});

// Index for better search performance
productSchema.index({ name: "text", description: "text", tags: "text" });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ vendor: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ isRegionalSpecialty: 1 });

module.exports = mongoose.model("Product", productSchema);
