"""
Dynamic Pricing using Regression and Rule-Based Logic
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Dict
from bson import ObjectId
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.preprocessing import StandardScaler
from datetime import datetime, timedelta

from database import get_collection

router = APIRouter()

# Nepali festival periods for seasonal pricing
FESTIVAL_PERIODS = {
    "dashain": {"months": [9, 10], "multiplier": 1.15},  # 15% increase
    "tihar": {"months": [10, 11], "multiplier": 1.10},  # 10% increase
    "holi": {"months": [2, 3], "multiplier": 1.05},  # 5% increase
    "new_year": {"months": [4], "multiplier": 1.08},  # 8% increase
}

# Category-specific pricing rules
CATEGORY_RULES = {
    "Food & Spices": {"min_margin": 0.15, "max_margin": 0.40, "elasticity": -1.2},
    "Textiles": {"min_margin": 0.20, "max_margin": 0.50, "elasticity": -0.8},
    "Handicrafts": {"min_margin": 0.25, "max_margin": 0.60, "elasticity": -0.6},
    "Agriculture": {"min_margin": 0.10, "max_margin": 0.30, "elasticity": -1.5},
    "Dairy & Cheese": {"min_margin": 0.12, "max_margin": 0.35, "elasticity": -1.3},
}

class PriceRequest(BaseModel):
    product_id: str

class BulkPriceRequest(BaseModel):
    product_ids: List[str]

class DynamicPricing:
    """Dynamic pricing engine using regression and rule-based logic"""

    def __init__(self):
        self.demand_model = None
        self.scaler = StandardScaler()
        self.model_trained = False

    async def get_product_features(self, product_id: str) -> Dict:
        """Get features for pricing model"""
        products_col = get_collection("products")
        interactions_col = get_collection("userproductinteractions")
        orders_col = get_collection("orders")

        # Get product info
        product = await products_col.find_one({"_id": ObjectId(product_id)})
        if not product:
            return None

        # Get interaction metrics
        interaction_stats = await interactions_col.aggregate([
            {"$match": {"product": ObjectId(product_id)}},
            {"$group": {
                "_id": None,
                "total_views": {"$sum": "$viewCount"},
                "total_cart_adds": {"$sum": "$cartAddCount"},
                "total_purchases": {"$sum": "$purchaseCount"},
                "unique_users": {"$sum": 1}
            }}
        ]).to_list(length=1)

        interaction_data = interaction_stats[0] if interaction_stats else {
            "total_views": 0,
            "total_cart_adds": 0,
            "total_purchases": 0,
            "unique_users": 0
        }

        # Get recent sales data (last 30 days)
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        sales_stats = await orders_col.aggregate([
            {"$match": {
                "createdAt": {"$gte": thirty_days_ago},
                "items.product": ObjectId(product_id),
                "orderStatus": {"$in": ["delivered", "shipped"]}
            }},
            {"$unwind": "$items"},
            {"$match": {"items.product": ObjectId(product_id)}},
            {"$group": {
                "_id": None,
                "total_quantity": {"$sum": "$items.quantity"},
                "total_revenue": {"$sum": {"$multiply": ["$items.price", "$items.quantity"]}},
                "order_count": {"$sum": 1},
                "avg_price": {"$avg": "$items.price"}
            }}
        ]).to_list(length=1)

        sales_data = sales_stats[0] if sales_stats else {
            "total_quantity": 0,
            "total_revenue": 0,
            "order_count": 0,
            "avg_price": product.get("price", 0)
        }

        return {
            "product": product,
            "interactions": interaction_data,
            "sales": sales_data
        }

    def calculate_demand_score(self, features: Dict) -> float:
        """Calculate demand score (0-1) based on features"""
        interactions = features["interactions"]
        sales = features["sales"]
        product = features["product"]

        # Normalize metrics
        view_score = min(interactions.get("total_views", 0) / 100, 1)
        cart_score = min(interactions.get("total_cart_adds", 0) / 20, 1)
        purchase_score = min(interactions.get("total_purchases", 0) / 10, 1)

        # Sales velocity (purchases per day)
        sales_velocity = sales.get("total_quantity", 0) / 30
        velocity_score = min(sales_velocity / 5, 1)  # Normalize to 5 sales/day max

        # Weighted demand score
        demand_score = (
            view_score * 0.15 +
            cart_score * 0.25 +
            purchase_score * 0.35 +
            velocity_score * 0.25
        )

        return round(demand_score, 4)

    def get_seasonal_factor(self) -> tuple:
        """Get current seasonal pricing factor"""
        current_month = datetime.utcnow().month

        for festival, data in FESTIVAL_PERIODS.items():
            if current_month in data["months"]:
                return data["multiplier"], festival

        return 1.0, None

    def calculate_inventory_factor(self, stock: int, avg_daily_sales: float) -> tuple:
        """Calculate price factor based on inventory levels"""
        if avg_daily_sales <= 0:
            avg_daily_sales = 0.5  # Default assumption

        days_of_stock = stock / avg_daily_sales

        if days_of_stock < 7:  # Less than a week of stock
            return 1.10, "low_inventory"  # 10% increase
        elif days_of_stock < 14:
            return 1.05, "moderate_inventory"
        elif days_of_stock > 60:  # More than 2 months
            return 0.90, "high_inventory"  # 10% decrease
        elif days_of_stock > 30:
            return 0.95, "excess_inventory"

        return 1.0, None

    async def calculate_price(self, product_id: str) -> Dict:
        """Calculate dynamic price for a product"""
        features = await self.get_product_features(product_id)

        if not features:
            return {"success": False, "message": "Product not found"}

        product = features["product"]
        base_price = product.get("price", 0)
        category = product.get("category", "Others")
        stock = product.get("stock", 0)

        # Get category rules
        category_rules = CATEGORY_RULES.get(category, {
            "min_margin": 0.15,
            "max_margin": 0.45,
            "elasticity": -1.0
        })

        # Calculate demand score
        demand_score = self.calculate_demand_score(features)

        # Get seasonal factor
        seasonal_factor, festival = self.get_seasonal_factor()

        # Calculate inventory factor
        avg_daily_sales = features["sales"].get("total_quantity", 0) / 30
        inventory_factor, inventory_reason = self.calculate_inventory_factor(stock, avg_daily_sales)

        # Calculate price adjustment based on demand
        # High demand (>0.7) -> increase price
        # Low demand (<0.3) -> decrease price
        if demand_score > 0.7:
            demand_adjustment = 1 + (demand_score - 0.5) * 0.2  # Up to 10% increase
            adjustment_reason = "high_demand"
        elif demand_score < 0.3:
            demand_adjustment = 1 - (0.5 - demand_score) * 0.15  # Up to 10% decrease
            adjustment_reason = "low_demand"
        else:
            demand_adjustment = 1.0
            adjustment_reason = None

        # Combine all factors
        total_adjustment = demand_adjustment * seasonal_factor * inventory_factor

        # Calculate recommended price
        recommended_price = base_price * total_adjustment

        # Apply min/max bounds based on category margins
        min_price = base_price * (1 - category_rules["max_margin"] * 0.5)  # Max 50% of max margin as discount
        max_price = base_price * (1 + category_rules["max_margin"])

        recommended_price = max(min_price, min(max_price, recommended_price))

        # Determine primary adjustment reason
        if inventory_reason in ["low_inventory", "high_inventory"]:
            primary_reason = inventory_reason
        elif festival:
            primary_reason = "festival"
        elif adjustment_reason:
            primary_reason = adjustment_reason
        else:
            primary_reason = "market_optimal"

        # Calculate adjustment percentage
        adjustment_percentage = ((recommended_price / base_price) - 1) * 100

        result = {
            "success": True,
            "product_id": product_id,
            "product_name": product.get("name"),
            "category": category,
            "base_price": round(base_price, 2),
            "recommended_price": round(recommended_price, 2),
            "min_price": round(min_price, 2),
            "max_price": round(max_price, 2),
            "adjustment_percentage": round(adjustment_percentage, 2),
            "adjustment_reason": primary_reason,
            "factors": {
                "demand_score": demand_score,
                "demand_adjustment": round(demand_adjustment, 4),
                "seasonal_factor": seasonal_factor,
                "festival": festival,
                "inventory_factor": inventory_factor,
                "inventory_reason": inventory_reason,
                "stock_level": stock
            },
            "metrics": {
                "views": features["interactions"].get("total_views", 0),
                "cart_adds": features["interactions"].get("total_cart_adds", 0),
                "purchases": features["interactions"].get("total_purchases", 0),
                "recent_sales": features["sales"].get("total_quantity", 0),
                "recent_revenue": features["sales"].get("total_revenue", 0)
            },
            "calculated_at": datetime.utcnow().isoformat()
        }

        # Save to database
        await self._save_price(result)

        return result

    async def _save_price(self, price_data: Dict):
        """Save calculated price to database"""
        prices_col = get_collection("dynamicprices")

        # Deactivate existing active prices for this product
        await prices_col.update_many(
            {"product": ObjectId(price_data["product_id"]), "isActive": True},
            {"$set": {"isActive": False}}
        )

        # Insert new price
        record = {
            "product": ObjectId(price_data["product_id"]),
            "basePrice": price_data["base_price"],
            "recommendedPrice": price_data["recommended_price"],
            "minPrice": price_data["min_price"],
            "maxPrice": price_data["max_price"],
            "demandScore": price_data["factors"]["demand_score"],
            "seasonalFactor": price_data["factors"]["seasonal_factor"],
            "inventoryLevel": price_data["factors"]["stock_level"],
            "adjustmentReason": price_data["adjustment_reason"],
            "adjustmentPercentage": price_data["adjustment_percentage"],
            "isActive": True,
            "validFrom": datetime.utcnow(),
            "validUntil": datetime.utcnow() + timedelta(days=7),  # Valid for 7 days
            "modelVersion": "regression-rules-1.0",
            "calculatedAt": datetime.utcnow()
        }

        await prices_col.insert_one(record)

    async def calculate_bulk_prices(self, product_ids: List[str]) -> List[Dict]:
        """Calculate prices for multiple products"""
        results = []
        for product_id in product_ids:
            result = await self.calculate_price(product_id)
            results.append(result)
        return results

    async def train_demand_model(self) -> Dict:
        """Train regression model on historical price-demand data"""
        orders_col = get_collection("orders")
        products_col = get_collection("products")

        # Get historical order data
        pipeline = [
            {"$match": {"orderStatus": {"$in": ["delivered", "shipped"]}}},
            {"$unwind": "$items"},
            {"$group": {
                "_id": {
                    "product": "$items.product",
                    "price": "$items.price"
                },
                "quantity_sold": {"$sum": "$items.quantity"},
                "order_count": {"$sum": 1}
            }},
            {"$lookup": {
                "from": "products",
                "localField": "_id.product",
                "foreignField": "_id",
                "as": "product_info"
            }},
            {"$unwind": "$product_info"}
        ]

        data = await orders_col.aggregate(pipeline).to_list(length=None)

        if len(data) < 10:
            return {
                "success": False,
                "message": "Insufficient data for training (need at least 10 data points)"
            }

        # Prepare training data
        X = []
        y = []

        for d in data:
            features = [
                d["_id"]["price"],
                d["product_info"].get("stock", 0),
                len(d["product_info"].get("images", [])),
                1 if d["product_info"].get("isFeatured") else 0
            ]
            X.append(features)
            y.append(d["quantity_sold"])

        X = np.array(X)
        y = np.array(y)

        # Scale features
        X_scaled = self.scaler.fit_transform(X)

        # Train model
        self.demand_model = Ridge(alpha=1.0)
        self.demand_model.fit(X_scaled, y)
        self.model_trained = True

        # Calculate R² score
        r2_score = self.demand_model.score(X_scaled, y)

        return {
            "success": True,
            "message": "Model trained successfully",
            "data_points": len(data),
            "r2_score": round(r2_score, 4),
            "coefficients": self.demand_model.coef_.tolist(),
            "trained_at": datetime.utcnow().isoformat()
        }

# Global pricing engine instance
pricing_engine = DynamicPricing()

@router.post("/calculate")
async def calculate_product_price(request: PriceRequest):
    """
    Calculate dynamic price for a product.

    Factors considered:
    - Demand score (views, cart adds, purchases)
    - Seasonal/festival pricing
    - Inventory levels
    - Category-specific rules
    """
    try:
        result = await pricing_engine.calculate_price(request.product_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/calculate/bulk")
async def calculate_bulk_prices(request: BulkPriceRequest):
    """Calculate dynamic prices for multiple products"""
    try:
        results = await pricing_engine.calculate_bulk_prices(request.product_ids)
        return {
            "success": True,
            "prices": results,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/product/{product_id}")
async def get_product_price(product_id: str):
    """Get current dynamic price for a product"""
    try:
        prices_col = get_collection("dynamicprices")

        price = await prices_col.find_one({
            "product": ObjectId(product_id),
            "isActive": True
        })

        if not price:
            # Calculate new price
            result = await pricing_engine.calculate_price(product_id)
            return result

        price["_id"] = str(price["_id"])
        price["product"] = str(price["product"])

        return {"success": True, "price": price}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train")
async def train_pricing_model():
    """Train the demand regression model on historical data"""
    try:
        result = await pricing_engine.train_demand_model()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/rules")
async def get_pricing_rules():
    """Get configured pricing rules and parameters"""
    return {
        "category_rules": CATEGORY_RULES,
        "festival_periods": FESTIVAL_PERIODS,
        "description": "Rules used for dynamic pricing calculations"
    }

@router.get("/history/{product_id}")
async def get_price_history(
    product_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    """Get price history for a product"""
    try:
        prices_col = get_collection("dynamicprices")

        skip = (page - 1) * limit

        prices = await prices_col.find({"product": ObjectId(product_id)}) \
            .sort("calculatedAt", -1) \
            .skip(skip) \
            .limit(limit) \
            .to_list(length=limit)

        total = await prices_col.count_documents({"product": ObjectId(product_id)})

        for p in prices:
            p["_id"] = str(p["_id"])
            p["product"] = str(p["product"])

        return {
            "product_id": product_id,
            "prices": prices,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "pages": (total + limit - 1) // limit
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/recommendations")
async def get_price_recommendations(
    category: Optional[str] = None,
    min_adjustment: float = Query(5.0, description="Minimum adjustment percentage to show"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    """Get products with significant price recommendations"""
    try:
        prices_col = get_collection("dynamicprices")

        query = {
            "isActive": True,
            "$or": [
                {"adjustmentPercentage": {"$gte": min_adjustment}},
                {"adjustmentPercentage": {"$lte": -min_adjustment}}
            ]
        }

        skip = (page - 1) * limit

        pipeline = [
            {"$match": query},
            {"$lookup": {
                "from": "products",
                "localField": "product",
                "foreignField": "_id",
                "as": "product_info"
            }},
            {"$unwind": "$product_info"},
        ]

        if category:
            pipeline.append({"$match": {"product_info.category": category}})

        pipeline.extend([
            {"$sort": {"adjustmentPercentage": -1}},
            {"$skip": skip},
            {"$limit": limit}
        ])

        recommendations = await prices_col.aggregate(pipeline).to_list(length=limit)

        for r in recommendations:
            r["_id"] = str(r["_id"])
            r["product"] = str(r["product"])
            r["product_info"]["_id"] = str(r["product_info"]["_id"])

        return {
            "recommendations": recommendations,
            "min_adjustment_threshold": min_adjustment
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/analytics")
async def get_pricing_analytics():
    """Get overall pricing analytics"""
    try:
        prices_col = get_collection("dynamicprices")

        # Adjustment distribution
        adjustment_pipeline = [
            {"$match": {"isActive": True}},
            {"$bucket": {
                "groupBy": "$adjustmentPercentage",
                "boundaries": [-20, -10, -5, 0, 5, 10, 20, 100],
                "default": "other",
                "output": {
                    "count": {"$sum": 1},
                    "avg_demand_score": {"$avg": "$demandScore"}
                }
            }}
        ]

        adjustment_dist = await prices_col.aggregate(adjustment_pipeline).to_list(length=None)

        # Reason distribution
        reason_pipeline = [
            {"$match": {"isActive": True}},
            {"$group": {
                "_id": "$adjustmentReason",
                "count": {"$sum": 1},
                "avg_adjustment": {"$avg": "$adjustmentPercentage"}
            }},
            {"$sort": {"count": -1}}
        ]

        reason_dist = await prices_col.aggregate(reason_pipeline).to_list(length=None)

        # Overall stats
        total_active = await prices_col.count_documents({"isActive": True})

        stats_pipeline = [
            {"$match": {"isActive": True}},
            {"$group": {
                "_id": None,
                "avg_adjustment": {"$avg": "$adjustmentPercentage"},
                "avg_demand_score": {"$avg": "$demandScore"},
                "total_base_price": {"$sum": "$basePrice"},
                "total_recommended_price": {"$sum": "$recommendedPrice"}
            }}
        ]

        overall_stats = await prices_col.aggregate(stats_pipeline).to_list(length=1)

        return {
            "total_active_prices": total_active,
            "adjustment_distribution": adjustment_dist,
            "reason_distribution": reason_dist,
            "overall_stats": overall_stats[0] if overall_stats else {}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
