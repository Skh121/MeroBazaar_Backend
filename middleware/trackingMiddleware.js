const { UserEvent, UserProductInteraction } = require("../models/UserBehavior");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");

// Try to extract user ID from token (for tracking on public routes)
const getUserIdFromToken = (req) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded.id || decoded.userId || decoded._id;
    }
  } catch (error) {
    // Token invalid or expired - that's fine, just return null
  }
  return null;
};

// Generate or retrieve session ID
const getSessionId = (req) => {
  // Check for existing session ID in cookies or headers
  let sessionId = req.cookies?.sessionId || req.headers["x-session-id"];

  if (!sessionId) {
    sessionId = uuidv4();
  }

  return sessionId;
};

// Parse user agent for device info
const parseUserAgent = (userAgent) => {
  const ua = userAgent?.toLowerCase() || "";

  let deviceType = "desktop";
  if (/mobile|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua)) {
    deviceType = /ipad|tablet/i.test(ua) ? "tablet" : "mobile";
  }

  let browser = "unknown";
  if (ua.includes("chrome")) browser = "chrome";
  else if (ua.includes("firefox")) browser = "firefox";
  else if (ua.includes("safari")) browser = "safari";
  else if (ua.includes("edge")) browser = "edge";

  let os = "unknown";
  if (ua.includes("windows")) os = "windows";
  else if (ua.includes("mac")) os = "macos";
  else if (ua.includes("linux")) os = "linux";
  else if (ua.includes("android")) os = "android";
  else if (ua.includes("ios") || ua.includes("iphone")) os = "ios";

  return { deviceType, browser, os };
};

// Middleware to attach tracking context to request
const trackingContext = (req, res, next) => {
  req.trackingContext = {
    sessionId: getSessionId(req),
    userId: req.user?._id || null,
    ...parseUserAgent(req.headers["user-agent"]),
    referrer: req.headers.referer || req.headers.referrer,
    pageUrl: req.originalUrl,
  };

  // Set session ID cookie if not present
  if (!req.cookies?.sessionId) {
    res.cookie("sessionId", req.trackingContext.sessionId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }

  next();
};

// Track user event
const trackEvent = async (eventData) => {
  try {
    const event = await UserEvent.create(eventData);

    // Update aggregated interactions if user and product are present
    if (eventData.user && eventData.product) {
      await updateInteractionScore(eventData.user, eventData.product, eventData.eventType, eventData);
    }

    return event;
  } catch (error) {
    console.error("Error tracking event:", error);
    return null;
  }
};

// Update user-product interaction scores
const updateInteractionScore = async (userId, productId, eventType, eventData = {}) => {
  try {
    const updateFields = {
      lastInteraction: new Date(),
    };

    const incrementFields = {};

    switch (eventType) {
      case "view":
        incrementFields.viewCount = 1;
        if (eventData.timeOnPage) {
          incrementFields.totalTimeViewed = eventData.timeOnPage;
        }
        break;
      case "click":
        incrementFields.clickCount = 1;
        break;
      case "add_to_cart":
        incrementFields.cartAddCount = 1;
        break;
      case "purchase":
        incrementFields.purchaseCount = eventData.quantity || 1;
        break;
      case "wishlist_add":
        incrementFields.wishlistCount = 1;
        break;
      case "wishlist_remove":
        incrementFields.wishlistCount = -1;
        break;
    }

    // Upsert interaction record
    const interaction = await UserProductInteraction.findOneAndUpdate(
      { user: userId, product: productId },
      {
        $set: updateFields,
        $inc: incrementFields,
      },
      { upsert: true, new: true }
    );

    // Recalculate interaction score
    interaction.calculateScore();
    await interaction.save();

    return interaction;
  } catch (error) {
    console.error("Error updating interaction score:", error);
    return null;
  }
};

// Deduplication time window in minutes
const VIEW_DEDUP_WINDOW_MINUTES = 30;

// Check if a view event already exists within the deduplication window
const isDuplicateView = async (sessionId, productId, userId = null) => {
  const windowStart = new Date(Date.now() - VIEW_DEDUP_WINDOW_MINUTES * 60 * 1000);

  // Build query for deduplication
  const query = {
    product: productId,
    eventType: "view",
    timestamp: { $gte: windowStart },
  };

  // If user is logged in, dedupe by user ID only (allows different users on same browser)
  // If not logged in, dedupe by session ID
  if (userId) {
    query.user = userId;
  } else {
    query.sessionId = sessionId;
  }

  const existingView = await UserEvent.findOne(query);
  return !!existingView;
};

// Middleware to track product views automatically with deduplication
const trackProductView = async (req, res, next) => {
  // Track after response is sent
  res.on("finish", async () => {
    // Track for both 200 (OK) and 304 (Not Modified/Cached) responses
    if ((res.statusCode === 200 || res.statusCode === 304) && req.params.id) {
      const sessionId = req.trackingContext?.sessionId || getSessionId(req);
      // Try to get user ID from req.user (if protected route) or from token (public route)
      const userId = req.user?._id || getUserIdFromToken(req);
      const productId = req.params.id;

      // Check for duplicate view within time window
      const isDuplicate = await isDuplicateView(sessionId, productId, userId);

      if (!isDuplicate) {
        await trackEvent({
          user: userId,
          sessionId,
          eventType: "view",
          product: productId,
          metadata: {
            deviceType: req.trackingContext?.deviceType,
            browser: req.trackingContext?.browser,
            os: req.trackingContext?.os,
            referrer: req.trackingContext?.referrer,
            pageUrl: req.trackingContext?.pageUrl,
          },
        });
      }
    }
  });

  next();
};

module.exports = {
  trackingContext,
  trackEvent,
  trackProductView,
  updateInteractionScore,
  getSessionId,
  parseUserAgent,
  isDuplicateView,
  VIEW_DEDUP_WINDOW_MINUTES,
};
