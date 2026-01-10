const { UserEvent, UserProductInteraction } = require("../models/UserBehavior");
const Product = require("../models/Product");
const Order = require("../models/Order");
const mongoose = require("mongoose");

/**
 * Personalized Recommendation Service
 * Generates recommendations based on user's browsing and purchase history
 */

// Weights for different recommendation sources
const WEIGHTS = {
  CATEGORY_MATCH: 3,
  TAG_MATCH: 2,
  VENDOR_MATCH: 1,
  COLLABORATIVE: 4,
  PURCHASE_BASED: 5,
  VIEW_BASED: 2,
};

/**
 * Get personalized recommendations for a user
 * @param {string} userId - The user's ID
 * @param {number} limit - Number of recommendations to return
 * @returns {Promise<Array>} - Array of recommended products with reasons
 */
const getPersonalizedRecommendations = async (userId, limit = 12) => {
  try {
    // Step 1: Get user's interaction history
    const userHistory = await getUserHistory(userId);

    if (!userHistory.viewedProducts.length && !userHistory.purchasedProducts.length) {
      // No history - return popular products
      return await getPopularProducts(limit);
    }

    // Step 2: Get candidate products with scores
    const candidates = new Map(); // productId -> { score, reasons }

    // 2a: Category-based recommendations (from viewed/purchased categories)
    const categoryRecs = await getCategoryBasedRecommendations(
      userHistory.categories,
      userHistory.allInteractedProducts,
      Math.ceil(limit * 1.5)
    );
    categoryRecs.forEach((rec) => {
      addCandidate(candidates, rec.product, rec.score * WEIGHTS.CATEGORY_MATCH, rec.reason);
    });

    // 2b: Tag-based recommendations
    const tagRecs = await getTagBasedRecommendations(
      userHistory.tags,
      userHistory.allInteractedProducts,
      Math.ceil(limit * 1.5)
    );
    tagRecs.forEach((rec) => {
      addCandidate(candidates, rec.product, rec.score * WEIGHTS.TAG_MATCH, rec.reason);
    });

    // 2c: Collaborative filtering - users who bought/viewed X also bought/viewed Y
    const collaborativeRecs = await getCollaborativeRecommendations(
      userId,
      userHistory.viewedProducts,
      userHistory.purchasedProducts,
      userHistory.allInteractedProducts,
      Math.ceil(limit * 1.5)
    );
    collaborativeRecs.forEach((rec) => {
      addCandidate(candidates, rec.product, rec.score * WEIGHTS.COLLABORATIVE, rec.reason);
    });

    // 2d: Similar to purchased products
    const purchaseBasedRecs = await getSimilarToProducts(
      userHistory.purchasedProducts.slice(0, 5),
      userHistory.allInteractedProducts,
      Math.ceil(limit)
    );
    purchaseBasedRecs.forEach((rec) => {
      addCandidate(candidates, rec.product, rec.score * WEIGHTS.PURCHASE_BASED, "Similar to your purchases");
    });

    // 2e: Similar to recently viewed products
    const viewBasedRecs = await getSimilarToProducts(
      userHistory.viewedProducts.slice(0, 5),
      userHistory.allInteractedProducts,
      Math.ceil(limit)
    );
    viewBasedRecs.forEach((rec) => {
      addCandidate(candidates, rec.product, rec.score * WEIGHTS.VIEW_BASED, "Based on your interest");
    });

    // Step 3: Sort by score and get top recommendations
    const sortedCandidates = Array.from(candidates.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);

    // Step 4: Fetch full product details
    const productIds = sortedCandidates.map(([id]) => id);
    const products = await Product.find({
      _id: { $in: productIds },
      status: "active",
    }).populate("vendor", "businessName");

    // Map products with their recommendation reasons
    const productMap = new Map(products.map((p) => [p._id.toString(), p]));
    const recommendations = sortedCandidates
      .filter(([id]) => productMap.has(id))
      .map(([id, data]) => ({
        product: productMap.get(id),
        score: data.score,
        reason: data.reasons[0], // Primary reason
        allReasons: data.reasons,
      }));

    return recommendations;
  } catch (error) {
    console.error("Error generating personalized recommendations:", error);
    return await getPopularProducts(limit);
  }
};

/**
 * Get user's interaction history
 */
const getUserHistory = async (userId) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get viewed products (recent views)
  const viewEvents = await UserEvent.find({
    user: userId,
    eventType: "view",
    product: { $exists: true },
    timestamp: { $gte: thirtyDaysAgo },
  })
    .sort({ timestamp: -1 })
    .limit(50)
    .select("product category");

  // Get purchased products from orders
  const orders = await Order.find({
    user: userId,
    orderStatus: { $in: ["delivered", "shipped", "processing", "confirmed"] },
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("items");

  const purchasedProducts = [];
  orders.forEach((order) => {
    order.items.forEach((item) => {
      if (item.product) {
        purchasedProducts.push(item.product.toString());
      }
    });
  });

  // Get cart additions
  const cartEvents = await UserEvent.find({
    user: userId,
    eventType: "add_to_cart",
    product: { $exists: true },
    timestamp: { $gte: thirtyDaysAgo },
  })
    .sort({ timestamp: -1 })
    .limit(20)
    .select("product");

  const viewedProducts = [...new Set(viewEvents.map((e) => e.product.toString()))];
  const cartProducts = [...new Set(cartEvents.map((e) => e.product.toString()))];
  const uniquePurchased = [...new Set(purchasedProducts)];
  const allInteractedProducts = [...new Set([...viewedProducts, ...uniquePurchased, ...cartProducts])];

  // Get categories from viewed products
  const categories = [...new Set(viewEvents.map((e) => e.category).filter(Boolean))];

  // Get tags from interacted products
  const interactedProducts = await Product.find({
    _id: { $in: allInteractedProducts.slice(0, 20) },
  }).select("tags category");

  const tags = [];
  interactedProducts.forEach((p) => {
    if (p.tags) tags.push(...p.tags);
    if (p.category) categories.push(p.category);
  });

  return {
    viewedProducts,
    purchasedProducts: uniquePurchased,
    cartProducts,
    allInteractedProducts,
    categories: [...new Set(categories)],
    tags: [...new Set(tags)],
  };
};

/**
 * Get recommendations based on categories user has shown interest in
 */
const getCategoryBasedRecommendations = async (categories, excludeIds, limit) => {
  if (!categories.length) return [];

  const products = await Product.find({
    category: { $in: categories },
    _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)) },
    status: "active",
  })
    .sort({ rating: -1, reviewCount: -1 })
    .limit(limit)
    .select("_id category");

  return products.map((p) => ({
    product: p._id.toString(),
    score: 1,
    reason: "Popular in categories you like",
  }));
};

/**
 * Get recommendations based on tags from products user interacted with
 */
const getTagBasedRecommendations = async (tags, excludeIds, limit) => {
  if (!tags.length) return [];

  const products = await Product.find({
    tags: { $in: tags },
    _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)) },
    status: "active",
  })
    .sort({ rating: -1 })
    .limit(limit)
    .select("_id");

  return products.map((p) => ({
    product: p._id.toString(),
    score: 1,
    reason: "Matches your interests",
  }));
};

/**
 * Collaborative filtering - find products that similar users liked
 */
const getCollaborativeRecommendations = async (
  userId,
  viewedProducts,
  purchasedProducts,
  excludeIds,
  limit
) => {
  const interactedProducts = [...viewedProducts.slice(0, 10), ...purchasedProducts.slice(0, 10)];
  if (!interactedProducts.length) return [];

  // Find other users who interacted with the same products
  const similarUsers = await UserEvent.aggregate([
    {
      $match: {
        product: { $in: interactedProducts.map((id) => new mongoose.Types.ObjectId(id)) },
        user: { $ne: new mongoose.Types.ObjectId(userId), $exists: true },
        eventType: { $in: ["view", "add_to_cart", "purchase"] },
      },
    },
    {
      $group: {
        _id: "$user",
        sharedProducts: { $addToSet: "$product" },
        eventCount: { $sum: 1 },
      },
    },
    {
      $match: {
        eventCount: { $gte: 2 }, // At least 2 shared interactions
      },
    },
    { $sort: { eventCount: -1 } },
    { $limit: 50 },
  ]);

  if (!similarUsers.length) return [];

  const similarUserIds = similarUsers.map((u) => u._id);

  // Find products those users also liked but current user hasn't seen
  const collaborativeProducts = await UserEvent.aggregate([
    {
      $match: {
        user: { $in: similarUserIds },
        product: {
          $exists: true,
          $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
        eventType: { $in: ["add_to_cart", "purchase", "wishlist_add"] },
      },
    },
    {
      $group: {
        _id: "$product",
        userCount: { $addToSet: "$user" },
        eventCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 1,
        score: { $multiply: [{ $size: "$userCount" }, "$eventCount"] },
      },
    },
    { $sort: { score: -1 } },
    { $limit: limit },
  ]);

  return collaborativeProducts.map((p) => ({
    product: p._id.toString(),
    score: Math.min(p.score / 10, 5), // Normalize score
    reason: "Popular with customers like you",
  }));
};

/**
 * Get products similar to given products (by category and tags)
 */
const getSimilarToProducts = async (productIds, excludeIds, limit) => {
  if (!productIds.length) return [];

  // Get details of source products
  const sourceProducts = await Product.find({
    _id: { $in: productIds.slice(0, 5) },
  }).select("category tags vendor");

  const categories = [...new Set(sourceProducts.map((p) => p.category))];
  const tags = [...new Set(sourceProducts.flatMap((p) => p.tags || []))];
  const vendors = sourceProducts.map((p) => p.vendor);

  // Find similar products
  const similarProducts = await Product.aggregate([
    {
      $match: {
        _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)) },
        status: "active",
        $or: [{ category: { $in: categories } }, { tags: { $in: tags } }, { vendor: { $in: vendors } }],
      },
    },
    {
      $addFields: {
        similarityScore: {
          $add: [
            { $cond: [{ $in: ["$category", categories] }, 3, 0] },
            {
              $multiply: [
                { $size: { $setIntersection: [{ $ifNull: ["$tags", []] }, tags] } },
                1,
              ],
            },
            { $cond: [{ $in: ["$vendor", vendors] }, 1, 0] },
          ],
        },
      },
    },
    { $sort: { similarityScore: -1, rating: -1 } },
    { $limit: limit },
    { $project: { _id: 1, similarityScore: 1 } },
  ]);

  return similarProducts.map((p) => ({
    product: p._id.toString(),
    score: p.similarityScore / 5, // Normalize
    reason: "Similar to items you liked",
  }));
};

/**
 * Get trending/popular products (fallback and for guest users)
 */
const getPopularProducts = async (limit = 12) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get products with most interactions in last 7 days
  const trendingProducts = await UserEvent.aggregate([
    {
      $match: {
        timestamp: { $gte: sevenDaysAgo },
        product: { $exists: true },
        eventType: { $in: ["view", "add_to_cart", "purchase"] },
      },
    },
    {
      $group: {
        _id: "$product",
        viewCount: { $sum: { $cond: [{ $eq: ["$eventType", "view"] }, 1, 0] } },
        cartCount: { $sum: { $cond: [{ $eq: ["$eventType", "add_to_cart"] }, 1, 0] } },
        purchaseCount: { $sum: { $cond: [{ $eq: ["$eventType", "purchase"] }, 1, 0] } },
      },
    },
    {
      $addFields: {
        trendScore: {
          $add: ["$viewCount", { $multiply: ["$cartCount", 3] }, { $multiply: ["$purchaseCount", 5] }],
        },
      },
    },
    { $sort: { trendScore: -1 } },
    { $limit: limit * 2 },
  ]);

  const productIds = trendingProducts.map((p) => p._id);

  // Fetch product details
  let products = await Product.find({
    _id: { $in: productIds },
    status: "active",
  }).populate("vendor", "businessName");

  // If not enough trending, add high-rated products
  if (products.length < limit) {
    const additionalProducts = await Product.find({
      _id: { $nin: productIds },
      status: "active",
    })
      .sort({ rating: -1, reviewCount: -1 })
      .limit(limit - products.length)
      .populate("vendor", "businessName");

    products = [...products, ...additionalProducts];
  }

  // Create score map from aggregation
  const scoreMap = new Map(trendingProducts.map((p) => [p._id.toString(), p.trendScore]));

  return products.slice(0, limit).map((product) => ({
    product,
    score: scoreMap.get(product._id.toString()) || 0,
    reason: "Recently trending",
    allReasons: ["Recently trending"],
  }));
};

/**
 * Get trending products for the Trending tab
 */
const getTrendingProducts = async (limit = 12) => {
  return await getPopularProducts(limit);
};

/**
 * Get seasonal products based on current season
 */
const getSeasonalProducts = async (limit = 12) => {
  const month = new Date().getMonth();
  let season, keywords;

  if (month >= 2 && month <= 4) {
    season = "Spring";
    keywords = ["spring", "flower", "fresh", "light", "garden"];
  } else if (month >= 5 && month <= 7) {
    season = "Summer";
    keywords = ["summer", "cool", "cotton", "light", "fresh", "cold"];
  } else if (month >= 8 && month <= 10) {
    season = "Autumn";
    keywords = ["autumn", "fall", "harvest", "warm"];
  } else {
    season = "Winter";
    keywords = ["winter", "wool", "sweater", "warm", "hot", "tea", "blanket", "jacket", "cozy"];
  }

  // Search products matching seasonal keywords
  const seasonalProducts = await Product.find({
    status: "active",
    $or: [
      { name: { $regex: keywords.join("|"), $options: "i" } },
      { description: { $regex: keywords.join("|"), $options: "i" } },
      { tags: { $in: keywords } },
    ],
  })
    .sort({ rating: -1, reviewCount: -1 })
    .limit(limit)
    .populate("vendor", "businessName");

  // If not enough seasonal products, add popular products
  let products = seasonalProducts;
  if (products.length < limit) {
    const additionalProducts = await Product.find({
      _id: { $nin: products.map((p) => p._id) },
      status: "active",
    })
      .sort({ rating: -1, reviewCount: -1 })
      .limit(limit - products.length)
      .populate("vendor", "businessName");

    products = [...products, ...additionalProducts];
  }

  return {
    season,
    products: products.map((product) => ({
      product,
      season,
      reason: `Perfect for ${season}`,
    })),
  };
};

/**
 * Helper function to add candidate with score accumulation
 */
const addCandidate = (candidates, productId, score, reason) => {
  if (candidates.has(productId)) {
    const existing = candidates.get(productId);
    existing.score += score;
    if (!existing.reasons.includes(reason)) {
      existing.reasons.push(reason);
    }
  } else {
    candidates.set(productId, {
      score,
      reasons: [reason],
    });
  }
};

module.exports = {
  getPersonalizedRecommendations,
  getTrendingProducts,
  getSeasonalProducts,
  getPopularProducts,
};
