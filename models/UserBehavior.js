const mongoose = require("mongoose");

// Schema for tracking individual user events
const userEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      enum: [
        "view",
        "click",
        "add_to_cart",
        "remove_from_cart",
        "purchase",
        "search",
        "wishlist_add",
        "wishlist_remove",
      ],
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      index: true,
    },
    category: {
      type: String,
    },
    searchQuery: {
      type: String,
    },
    quantity: {
      type: Number,
      default: 1,
    },
    price: {
      type: Number,
    },
    metadata: {
      referrer: String,
      deviceType: {
        type: String,
        enum: ["desktop", "mobile", "tablet"],
      },
      browser: String,
      os: String,
      pageUrl: String,
      timeOnPage: Number, // seconds
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient querying
userEventSchema.index({ user: 1, eventType: 1, timestamp: -1 });
userEventSchema.index({ product: 1, eventType: 1, timestamp: -1 });
userEventSchema.index({ sessionId: 1, timestamp: 1 });

const UserEvent = mongoose.model("UserEvent", userEventSchema);

// Schema for aggregated user-product interactions (for recommendations)
const userProductInteractionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Implicit feedback scores
    viewCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    cartAddCount: { type: Number, default: 0 },
    purchaseCount: { type: Number, default: 0 },
    wishlistCount: { type: Number, default: 0 },
    totalTimeViewed: { type: Number, default: 0 }, // seconds
    // Computed interaction score (weighted combination)
    interactionScore: { type: Number, default: 0 },
    lastInteraction: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

userProductInteractionSchema.index({ user: 1, product: 1 }, { unique: true });
userProductInteractionSchema.index({ user: 1, interactionScore: -1 });
userProductInteractionSchema.index({ product: 1, interactionScore: -1 });

// Method to calculate interaction score
userProductInteractionSchema.methods.calculateScore = function () {
  // Weights for different interactions (implicit feedback)
  const weights = {
    view: 1,
    click: 2,
    cartAdd: 3,
    wishlist: 3,
    purchase: 5,
  };

  this.interactionScore =
    this.viewCount * weights.view +
    this.clickCount * weights.click +
    this.cartAddCount * weights.cartAdd +
    this.wishlistCount * weights.wishlist +
    this.purchaseCount * weights.purchase;

  return this.interactionScore;
};

const UserProductInteraction = mongoose.model(
  "UserProductInteraction",
  userProductInteractionSchema
);

// Schema for customer segments (RFM analysis results)
const customerSegmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    // RFM Scores
    recency: { type: Number }, // Days since last purchase
    frequency: { type: Number }, // Number of purchases
    monetary: { type: Number }, // Total spend
    // RFM Quartile scores (1-4)
    recencyScore: { type: Number, min: 1, max: 4 },
    frequencyScore: { type: Number, min: 1, max: 4 },
    monetaryScore: { type: Number, min: 1, max: 4 },
    rfmScore: { type: Number }, // Combined score
    // Segment assignment
    segment: {
      type: String,
      enum: [
        "Champions",
        "Loyal Customers",
        "Potential Loyalists",
        "Recent Customers",
        "Promising",
        "Needs Attention",
        "About to Sleep",
        "At Risk",
        "Cannot Lose",
        "Hibernating",
        "Lost",
      ],
    },
    cluster: { type: Number }, // K-Means cluster ID
    // Analytics metadata
    lastPurchaseDate: { type: Date },
    firstPurchaseDate: { type: Date },
    avgOrderValue: { type: Number },
    totalOrders: { type: Number },
    calculatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

customerSegmentSchema.index({ segment: 1 });
customerSegmentSchema.index({ cluster: 1 });
customerSegmentSchema.index({ rfmScore: -1 });

const CustomerSegment = mongoose.model(
  "CustomerSegment",
  customerSegmentSchema
);

// Schema for product demand forecasts
const demandForecastSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    forecastDate: {
      type: Date,
      required: true,
    },
    predictedDemand: {
      type: Number,
      required: true,
    },
    lowerBound: { type: Number }, // Confidence interval
    upperBound: { type: Number },
    confidence: { type: Number }, // Confidence level
    // Seasonality components
    trend: { type: Number },
    seasonal: { type: Number },
    holiday: { type: Number },
    // Metadata
    modelVersion: { type: String },
    calculatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

demandForecastSchema.index({ product: 1, forecastDate: 1 }, { unique: true });
demandForecastSchema.index({ category: 1, forecastDate: 1 });

const DemandForecast = mongoose.model("DemandForecast", demandForecastSchema);

// Schema for dynamic pricing
const dynamicPriceSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    basePrice: {
      type: Number,
      required: true,
    },
    recommendedPrice: {
      type: Number,
      required: true,
    },
    minPrice: { type: Number },
    maxPrice: { type: Number },
    // Factors affecting price
    demandScore: { type: Number }, // 0-1
    competitorPrice: { type: Number },
    inventoryLevel: { type: Number },
    seasonalFactor: { type: Number },
    // Price adjustments
    adjustmentReason: {
      type: String,
      enum: [
        "high_demand",
        "low_demand",
        "low_inventory",
        "high_inventory",
        "seasonal",
        "competitor",
        "festival",
        "clearance",
      ],
    },
    adjustmentPercentage: { type: Number },
    // Status
    isActive: { type: Boolean, default: true },
    validFrom: { type: Date, default: Date.now },
    validUntil: { type: Date },
    // Metadata
    modelVersion: { type: String },
    calculatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

dynamicPriceSchema.index({ product: 1, isActive: 1 });
dynamicPriceSchema.index({ validFrom: 1, validUntil: 1 });

const DynamicPrice = mongoose.model("DynamicPrice", dynamicPriceSchema);

module.exports = {
  UserEvent,
  UserProductInteraction,
  CustomerSegment,
  DemandForecast,
  DynamicPrice,
};
