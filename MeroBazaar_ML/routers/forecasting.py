"""
Demand Forecasting using Prophet with Seasonality and Festival Effects
Falls back to simple moving average if Prophet is not available
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Dict
from bson import ObjectId
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# Try to import Prophet, use fallback if not available
try:
    from prophet import Prophet
    PROPHET_AVAILABLE = True
except ImportError:
    PROPHET_AVAILABLE = False
    print("Prophet not available. Using simple forecasting fallback.")

from database import get_collection

router = APIRouter()

# Nepali festivals and holidays (approximate dates - can vary by year)
NEPALI_HOLIDAYS = [
    {"holiday": "dashain", "ds": "2024-10-12", "lower_window": -7, "upper_window": 5},
    {"holiday": "dashain", "ds": "2025-10-02", "lower_window": -7, "upper_window": 5},
    {"holiday": "tihar", "ds": "2024-11-01", "lower_window": -2, "upper_window": 3},
    {"holiday": "tihar", "ds": "2025-10-21", "lower_window": -2, "upper_window": 3},
    {"holiday": "holi", "ds": "2024-03-25", "lower_window": -1, "upper_window": 1},
    {"holiday": "holi", "ds": "2025-03-14", "lower_window": -1, "upper_window": 1},
    {"holiday": "new_year", "ds": "2024-04-14", "lower_window": -2, "upper_window": 2},
    {"holiday": "new_year", "ds": "2025-04-14", "lower_window": -2, "upper_window": 2},
    {"holiday": "teej", "ds": "2024-09-06", "lower_window": -3, "upper_window": 1},
    {"holiday": "teej", "ds": "2025-08-26", "lower_window": -3, "upper_window": 1},
    {"holiday": "chhath", "ds": "2024-11-07", "lower_window": -2, "upper_window": 2},
    {"holiday": "chhath", "ds": "2025-10-28", "lower_window": -2, "upper_window": 2},
    {"holiday": "maghe_sankranti", "ds": "2024-01-15", "lower_window": -1, "upper_window": 1},
    {"holiday": "maghe_sankranti", "ds": "2025-01-15", "lower_window": -1, "upper_window": 1},
]

class ForecastRequest(BaseModel):
    product_id: Optional[str] = None
    category: Optional[str] = None
    days: int = 30

class DemandForecaster:
    """Prophet-based demand forecasting with seasonality and festival effects"""

    def __init__(self):
        self.holidays_df = pd.DataFrame(NEPALI_HOLIDAYS)

    async def get_historical_demand(
        self,
        product_id: Optional[str] = None,
        category: Optional[str] = None
    ) -> pd.DataFrame:
        """Get historical demand data from orders"""
        orders_col = get_collection("orders")

        # Build aggregation pipeline
        match_stage = {"orderStatus": {"$in": ["delivered", "shipped"]}}

        if product_id:
            match_stage["items.product"] = ObjectId(product_id)

        pipeline = [
            {"$match": match_stage},
            {"$unwind": "$items"},
        ]

        if product_id:
            pipeline.append({"$match": {"items.product": ObjectId(product_id)}})

        if category:
            # Need to lookup product to filter by category
            pipeline.extend([
                {"$lookup": {
                    "from": "products",
                    "localField": "items.product",
                    "foreignField": "_id",
                    "as": "product_info"
                }},
                {"$unwind": "$product_info"},
                {"$match": {"product_info.category": category}}
            ])

        pipeline.extend([
            {"$group": {
                "_id": {
                    "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt"}}
                },
                "quantity": {"$sum": "$items.quantity"},
                "revenue": {"$sum": {"$multiply": ["$items.price", "$items.quantity"]}}
            }},
            {"$sort": {"_id.date": 1}}
        ])

        results = await orders_col.aggregate(pipeline).to_list(length=None)

        if not results:
            return pd.DataFrame()

        # Create DataFrame
        df = pd.DataFrame([
            {"ds": r["_id"]["date"], "y": r["quantity"], "revenue": r["revenue"]}
            for r in results
        ])

        df["ds"] = pd.to_datetime(df["ds"])

        return df

    def create_prophet_model(self, include_holidays: bool = True):
        """Create and configure Prophet model"""
        if not PROPHET_AVAILABLE:
            return None

        model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=True,
            daily_seasonality=False,
            seasonality_mode="multiplicative",
            changepoint_prior_scale=0.05,
            interval_width=0.95
        )

        # Add custom seasonalities
        model.add_seasonality(
            name="monthly",
            period=30.5,
            fourier_order=5
        )

        # Add Nepali festival holidays
        if include_holidays and not self.holidays_df.empty:
            model.holidays = self.holidays_df

        return model

    def simple_forecast(self, df: pd.DataFrame, days: int) -> pd.DataFrame:
        """Simple moving average forecast as fallback"""
        # Use last 7 days moving average
        window = min(7, len(df))
        avg_demand = df["y"].tail(window).mean()
        std_demand = df["y"].tail(window).std()

        # Add some variance based on day of week patterns
        last_date = df["ds"].max()
        future_dates = pd.date_range(start=last_date + timedelta(days=1), periods=days)

        predictions = []
        for date in future_dates:
            # Simple weekly pattern adjustment
            dow_factor = 1.0
            if date.weekday() in [5, 6]:  # Weekend
                dow_factor = 1.2
            elif date.weekday() == 0:  # Monday
                dow_factor = 0.9

            pred = avg_demand * dow_factor
            predictions.append({
                "ds": date,
                "yhat": pred,
                "yhat_lower": max(0, pred - 1.5 * std_demand),
                "yhat_upper": pred + 1.5 * std_demand,
                "trend": avg_demand,
                "weekly": dow_factor - 1,
                "yearly": 0
            })

        return pd.DataFrame(predictions)

    async def forecast(
        self,
        product_id: Optional[str] = None,
        category: Optional[str] = None,
        days: int = 30
    ) -> Dict:
        """Generate demand forecast"""
        # Get historical data
        df = await self.get_historical_demand(product_id, category)

        if df.empty or len(df) < 7:  # Need at least 1 week of data
            return {
                "success": False,
                "message": "Insufficient historical data for forecasting (need at least 7 days)"
            }

        # Use Prophet if available, otherwise use simple forecast
        if PROPHET_AVAILABLE:
            model = self.create_prophet_model()
            model.fit(df[["ds", "y"]])
            future = model.make_future_dataframe(periods=days)
            forecast = model.predict(future)
            future_forecast = forecast[forecast["ds"] > df["ds"].max()]
            forecast_method = "prophet"
        else:
            future_forecast = self.simple_forecast(df, days)
            forecast_method = "moving_average"

        # Save forecasts to database
        await self._save_forecasts(
            forecast_df=future_forecast,
            product_id=product_id,
            category=category
        )

        # Prepare response
        predictions = []
        for _, row in future_forecast.iterrows():
            predictions.append({
                "date": row["ds"].strftime("%Y-%m-%d") if hasattr(row["ds"], "strftime") else str(row["ds"])[:10],
                "predicted_demand": max(0, round(row["yhat"], 2)),
                "lower_bound": max(0, round(row["yhat_lower"], 2)),
                "upper_bound": max(0, round(row["yhat_upper"], 2)),
                "trend": round(row["trend"], 2) if "trend" in row and row["trend"] is not None else None,
                "weekly": round(row["weekly"], 4) if "weekly" in row and row["weekly"] is not None else None,
                "yearly": round(row["yearly"], 4) if "yearly" in row and row["yearly"] is not None else None,
            })

        # Calculate summary statistics
        total_predicted = sum(p["predicted_demand"] for p in predictions)
        avg_daily = total_predicted / len(predictions) if predictions else 0

        return {
            "success": True,
            "product_id": product_id,
            "category": category,
            "forecast_days": days,
            "forecast_method": forecast_method,
            "predictions": predictions,
            "summary": {
                "total_predicted_demand": round(total_predicted, 2),
                "average_daily_demand": round(avg_daily, 2),
                "peak_day": max(predictions, key=lambda x: x["predicted_demand"]) if predictions else None,
                "lowest_day": min(predictions, key=lambda x: x["predicted_demand"]) if predictions else None
            },
            "historical_data_points": len(df),
            "generated_at": datetime.utcnow().isoformat()
        }

    async def _save_forecasts(
        self,
        forecast_df: pd.DataFrame,
        product_id: Optional[str],
        category: Optional[str]
    ):
        """Save forecasts to database"""
        forecasts_col = get_collection("demandforecasts")

        # Delete existing forecasts for this product/category
        delete_filter = {}
        if product_id:
            delete_filter["product"] = ObjectId(product_id)
        if category:
            delete_filter["category"] = category

        if delete_filter:
            await forecasts_col.delete_many(delete_filter)

        # Insert new forecasts
        records = []
        for _, row in forecast_df.iterrows():
            record = {
                "forecastDate": row["ds"],
                "predictedDemand": max(0, round(row["yhat"], 2)),
                "lowerBound": max(0, round(row["yhat_lower"], 2)),
                "upperBound": max(0, round(row["yhat_upper"], 2)),
                "trend": round(row["trend"], 2) if "trend" in row else None,
                "seasonal": round(row.get("weekly", 0) + row.get("yearly", 0), 4),
                "modelVersion": "prophet-1.0",
                "calculatedAt": datetime.utcnow()
            }

            if product_id:
                record["product"] = ObjectId(product_id)
            if category:
                record["category"] = category

            records.append(record)

        if records:
            await forecasts_col.insert_many(records)

    async def get_category_forecasts(self, days: int = 30) -> Dict:
        """Generate forecasts for all categories"""
        products_col = get_collection("products")

        # Get unique categories
        categories = await products_col.distinct("category", {"status": "active"})

        results = {}
        for category in categories:
            forecast = await self.forecast(category=category, days=days)
            results[category] = forecast

        return results

# Global forecaster instance
forecaster = DemandForecaster()

@router.post("/predict")
async def generate_forecast(request: ForecastRequest):
    """
    Generate demand forecast for a product or category.

    - **product_id**: Optional product ObjectId for product-specific forecast
    - **category**: Optional category name for category-wide forecast
    - **days**: Number of days to forecast (default: 30)
    """
    try:
        result = await forecaster.forecast(
            product_id=request.product_id,
            category=request.category,
            days=request.days
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/product/{product_id}")
async def get_product_forecast(
    product_id: str,
    days: int = Query(30, ge=7, le=90)
):
    """Get demand forecast for a specific product"""
    try:
        result = await forecaster.forecast(product_id=product_id, days=days)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/category/{category}")
async def get_category_forecast(
    category: str,
    days: int = Query(30, ge=7, le=90)
):
    """Get demand forecast for a category"""
    try:
        result = await forecaster.forecast(category=category, days=days)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/all-categories")
async def forecast_all_categories(days: int = Query(30, ge=7, le=90)):
    """Generate forecasts for all product categories"""
    try:
        result = await forecaster.get_category_forecasts(days=days)
        return {
            "success": True,
            "forecasts": result,
            "generated_at": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stored")
async def get_stored_forecasts(
    product_id: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100)
):
    """Get stored forecasts from database"""
    try:
        forecasts_col = get_collection("demandforecasts")

        query = {}
        if product_id:
            query["product"] = ObjectId(product_id)
        if category:
            query["category"] = category
        if start_date or end_date:
            query["forecastDate"] = {}
            if start_date:
                query["forecastDate"]["$gte"] = datetime.fromisoformat(start_date)
            if end_date:
                query["forecastDate"]["$lte"] = datetime.fromisoformat(end_date)

        skip = (page - 1) * limit

        forecasts = await forecasts_col.find(query) \
            .sort("forecastDate", 1) \
            .skip(skip) \
            .limit(limit) \
            .to_list(length=limit)

        total = await forecasts_col.count_documents(query)

        # Convert ObjectIds
        for f in forecasts:
            f["_id"] = str(f["_id"])
            if "product" in f:
                f["product"] = str(f["product"])

        return {
            "forecasts": forecasts,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "pages": (total + limit - 1) // limit
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/holidays")
async def get_configured_holidays():
    """Get list of configured Nepali holidays/festivals"""
    return {
        "holidays": NEPALI_HOLIDAYS,
        "description": "These festivals are factored into demand forecasting"
    }

@router.get("/trends")
async def get_demand_trends(
    category: Optional[str] = None,
    days: int = Query(30, ge=7, le=365)
):
    """Get historical demand trends"""
    try:
        orders_col = get_collection("orders")

        start_date = datetime.utcnow() - timedelta(days=days)

        match_stage = {
            "orderStatus": {"$in": ["delivered", "shipped"]},
            "createdAt": {"$gte": start_date}
        }

        pipeline = [
            {"$match": match_stage},
            {"$unwind": "$items"},
        ]

        if category:
            pipeline.extend([
                {"$lookup": {
                    "from": "products",
                    "localField": "items.product",
                    "foreignField": "_id",
                    "as": "product_info"
                }},
                {"$unwind": "$product_info"},
                {"$match": {"product_info.category": category}}
            ])

        pipeline.extend([
            {"$group": {
                "_id": {
                    "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt"}}
                },
                "total_quantity": {"$sum": "$items.quantity"},
                "total_revenue": {"$sum": {"$multiply": ["$items.price", "$items.quantity"]}},
                "order_count": {"$sum": 1}
            }},
            {"$sort": {"_id.date": 1}}
        ])

        results = await orders_col.aggregate(pipeline).to_list(length=None)

        trends = [
            {
                "date": r["_id"]["date"],
                "quantity": r["total_quantity"],
                "revenue": r["total_revenue"],
                "orders": r["order_count"]
            }
            for r in results
        ]

        return {
            "category": category,
            "period_days": days,
            "trends": trends,
            "summary": {
                "total_quantity": sum(t["quantity"] for t in trends),
                "total_revenue": sum(t["revenue"] for t in trends),
                "total_orders": sum(t["orders"] for t in trends),
                "avg_daily_quantity": sum(t["quantity"] for t in trends) / len(trends) if trends else 0
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
