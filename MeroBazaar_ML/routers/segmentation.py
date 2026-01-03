"""
Customer Segmentation using RFM Analysis and K-Means Clustering
"""

from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional, Dict
from bson import ObjectId
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from datetime import datetime, timedelta

from database import get_collection

router = APIRouter()

class CustomerSegmentation:
    """RFM Analysis and K-Means Clustering for customer segmentation"""

    # RFM Segment definitions (1-5 scale, 5 is best)
    SEGMENT_RULES = {
        "Champions": {"r": [4, 5], "f": [4, 5], "m": [4, 5]},
        "Loyal Customers": {"r": [3, 5], "f": [3, 5], "m": [3, 5]},
        "Potential Loyalists": {"r": [4, 5], "f": [2, 4], "m": [2, 4]},
        "Recent Customers": {"r": [4, 5], "f": [1, 2], "m": [1, 3]},
        "Promising": {"r": [3, 4], "f": [1, 3], "m": [1, 3]},
        "Needs Attention": {"r": [2, 3], "f": [2, 4], "m": [2, 4]},
        "About to Sleep": {"r": [2, 3], "f": [1, 3], "m": [1, 3]},
        "At Risk": {"r": [1, 2], "f": [3, 5], "m": [3, 5]},
        "Cannot Lose": {"r": [1, 2], "f": [4, 5], "m": [4, 5]},
        "Hibernating": {"r": [1, 2], "f": [1, 3], "m": [1, 3]},
        "Lost": {"r": [1, 1], "f": [1, 2], "m": [1, 2]},
    }

    def __init__(self):
        self.kmeans_model = None
        self.scaler = StandardScaler()
        self.n_clusters = 5

    async def calculate_rfm(self) -> pd.DataFrame:
        """Calculate RFM metrics for all customers"""
        orders_col = get_collection("orders")

        # Get all completed orders
        pipeline = [
            {"$match": {"orderStatus": {"$in": ["delivered", "shipped"]}}},
            {"$group": {
                "_id": "$user",
                "last_order_date": {"$max": "$createdAt"},
                "first_order_date": {"$min": "$createdAt"},
                "order_count": {"$sum": 1},
                "total_spent": {"$sum": "$total"}
            }}
        ]

        results = await orders_col.aggregate(pipeline).to_list(length=None)

        if not results:
            return pd.DataFrame()

        # Create DataFrame
        df = pd.DataFrame(results)
        df.rename(columns={"_id": "user_id"}, inplace=True)

        # Calculate RFM metrics
        now = datetime.utcnow()

        # Recency: days since last purchase
        df["recency"] = df["last_order_date"].apply(
            lambda x: (now - x).days if x else 999
        )

        # Frequency: number of orders
        df["frequency"] = df["order_count"]

        # Monetary: total amount spent
        df["monetary"] = df["total_spent"]

        return df

    def calculate_rfm_scores(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate RFM scores (1-5 scale based on percentiles)"""
        if df.empty:
            return df

        n_customers = len(df)

        # For small datasets (< 10 customers), use fixed thresholds
        if n_customers < 10:
            # Recency: lower is better (score 1-5, 5 is best/most recent)
            df["r_score"] = pd.cut(
                df["recency"],
                bins=[-1, 7, 30, 90, 180, float('inf')],
                labels=[5, 4, 3, 2, 1]
            ).astype(int)

            # Frequency: higher is better
            df["f_score"] = pd.cut(
                df["frequency"],
                bins=[-1, 1, 3, 5, 10, float('inf')],
                labels=[1, 2, 3, 4, 5]
            ).astype(int)

            # Monetary: higher is better
            monetary_median = df["monetary"].median()
            df["m_score"] = pd.cut(
                df["monetary"],
                bins=[-1, monetary_median * 0.25, monetary_median * 0.5, monetary_median, monetary_median * 2, float('inf')],
                labels=[1, 2, 3, 4, 5]
            ).astype(int)
        else:
            # For larger datasets, use quintiles (5 groups)
            n_quantiles = min(5, n_customers)
            labels_asc = list(range(1, n_quantiles + 1))
            labels_desc = list(range(n_quantiles, 0, -1))

            # Recency: lower is better (invert the score)
            df["r_score"] = pd.qcut(
                df["recency"].rank(method="first"),
                q=n_quantiles,
                labels=labels_desc,
                duplicates="drop"
            ).astype(int)

            # Frequency: higher is better
            df["f_score"] = pd.qcut(
                df["frequency"].rank(method="first"),
                q=n_quantiles,
                labels=labels_asc,
                duplicates="drop"
            ).astype(int)

            # Monetary: higher is better
            df["m_score"] = pd.qcut(
                df["monetary"].rank(method="first"),
                q=n_quantiles,
                labels=labels_asc,
                duplicates="drop"
            ).astype(int)

        # Combined RFM score
        df["rfm_score"] = df["r_score"] + df["f_score"] + df["m_score"]

        return df

    def assign_segment(self, row: pd.Series) -> str:
        """Assign customer segment based on RFM scores"""
        r, f, m = row["r_score"], row["f_score"], row["m_score"]

        for segment, rules in self.SEGMENT_RULES.items():
            r_match = rules["r"][0] <= r <= rules["r"][1]
            f_match = rules["f"][0] <= f <= rules["f"][1]
            m_match = rules["m"][0] <= m <= rules["m"][1]

            if r_match and f_match and m_match:
                return segment

        return "Others"

    def perform_kmeans_clustering(self, df: pd.DataFrame) -> pd.DataFrame:
        """Perform K-Means clustering on RFM features"""
        if df.empty or len(df) < self.n_clusters:
            df["cluster"] = 0
            return df

        # Prepare features for clustering
        features = df[["recency", "frequency", "monetary"]].values

        # Normalize features
        features_scaled = self.scaler.fit_transform(features)

        # Perform K-Means clustering
        self.kmeans_model = KMeans(
            n_clusters=min(self.n_clusters, len(df)),
            random_state=42,
            n_init=10
        )
        df["cluster"] = self.kmeans_model.fit_predict(features_scaled)

        return df

    async def run_segmentation(self) -> Dict:
        """Run full segmentation pipeline"""
        # Calculate RFM
        df = await self.calculate_rfm()

        if df.empty:
            return {"success": False, "message": "No order data available"}

        # Calculate RFM scores
        df = self.calculate_rfm_scores(df)

        # Assign segments
        df["segment"] = df.apply(self.assign_segment, axis=1)

        # Perform K-Means clustering
        df = self.perform_kmeans_clustering(df)

        # Save to database
        segments_col = get_collection("customersegments")

        # Clear existing segments
        await segments_col.delete_many({})

        # Insert new segments
        records = []
        for _, row in df.iterrows():
            record = {
                "user": row["user_id"],
                "recency": int(row["recency"]),
                "frequency": int(row["frequency"]),
                "monetary": float(row["monetary"]),
                "recencyScore": int(row["r_score"]),
                "frequencyScore": int(row["f_score"]),
                "monetaryScore": int(row["m_score"]),
                "rfmScore": int(row["rfm_score"]),
                "segment": row["segment"],
                "cluster": int(row["cluster"]),
                "lastPurchaseDate": row["last_order_date"],
                "firstPurchaseDate": row["first_order_date"],
                "avgOrderValue": float(row["monetary"] / row["frequency"]) if row["frequency"] > 0 else 0,
                "totalOrders": int(row["frequency"]),
                "calculatedAt": datetime.utcnow()
            }
            records.append(record)

        if records:
            await segments_col.insert_many(records)

        # Calculate segment distribution
        segment_dist = df["segment"].value_counts().to_dict()
        cluster_dist = df["cluster"].value_counts().to_dict()

        return {
            "success": True,
            "total_customers": len(df),
            "segment_distribution": segment_dist,
            "cluster_distribution": cluster_dist,
            "timestamp": datetime.utcnow().isoformat()
        }

    async def get_segment_stats(self) -> Dict:
        """Get segment statistics from database"""
        segments_col = get_collection("customersegments")

        # Segment distribution
        segment_pipeline = [
            {"$group": {
                "_id": "$segment",
                "count": {"$sum": 1},
                "avg_monetary": {"$avg": "$monetary"},
                "avg_frequency": {"$avg": "$frequency"},
                "avg_recency": {"$avg": "$recency"},
                "total_revenue": {"$sum": "$monetary"}
            }},
            {"$sort": {"count": -1}}
        ]

        segment_stats = await segments_col.aggregate(segment_pipeline).to_list(length=None)

        # Cluster distribution
        cluster_pipeline = [
            {"$group": {
                "_id": "$cluster",
                "count": {"$sum": 1},
                "avg_monetary": {"$avg": "$monetary"},
                "avg_frequency": {"$avg": "$frequency"},
                "avg_recency": {"$avg": "$recency"}
            }},
            {"$sort": {"_id": 1}}
        ]

        cluster_stats = await segments_col.aggregate(cluster_pipeline).to_list(length=None)

        # Overall stats
        total = await segments_col.count_documents({})

        return {
            "total_customers": total,
            "segment_stats": segment_stats,
            "cluster_stats": cluster_stats
        }

# Global segmentation instance
segmentation_engine = CustomerSegmentation()

@router.post("/calculate")
async def calculate_segments():
    """
    Trigger customer segmentation calculation.
    This will:
    1. Calculate RFM metrics for all customers
    2. Assign RFM scores (1-4 quartiles)
    3. Assign customer segments based on RFM rules
    4. Perform K-Means clustering
    5. Save results to database
    """
    try:
        result = await segmentation_engine.run_segmentation()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_segmentation_stats():
    """Get customer segmentation statistics and distributions"""
    try:
        stats = await segmentation_engine.get_segment_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/user/{user_id}")
async def get_user_segment(user_id: str):
    """Get segmentation data for a specific user"""
    try:
        segments_col = get_collection("customersegments")
        segment = await segments_col.find_one({"user": ObjectId(user_id)})

        if not segment:
            return {"found": False, "message": "User segment not found"}

        segment["_id"] = str(segment["_id"])
        segment["user"] = str(segment["user"])

        return {"found": True, "segment": segment}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/segment/{segment_name}")
async def get_customers_by_segment(
    segment_name: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    """Get customers in a specific segment"""
    try:
        segments_col = get_collection("customersegments")

        skip = (page - 1) * limit

        customers = await segments_col.find({"segment": segment_name}) \
            .sort("rfmScore", -1) \
            .skip(skip) \
            .limit(limit) \
            .to_list(length=limit)

        total = await segments_col.count_documents({"segment": segment_name})

        # Convert ObjectIds to strings
        for c in customers:
            c["_id"] = str(c["_id"])
            c["user"] = str(c["user"])

        return {
            "segment": segment_name,
            "customers": customers,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "pages": (total + limit - 1) // limit
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/cluster/{cluster_id}")
async def get_customers_by_cluster(
    cluster_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    """Get customers in a specific K-Means cluster"""
    try:
        segments_col = get_collection("customersegments")

        skip = (page - 1) * limit

        customers = await segments_col.find({"cluster": cluster_id}) \
            .sort("rfmScore", -1) \
            .skip(skip) \
            .limit(limit) \
            .to_list(length=limit)

        total = await segments_col.count_documents({"cluster": cluster_id})

        for c in customers:
            c["_id"] = str(c["_id"])
            c["user"] = str(c["user"])

        return {
            "cluster": cluster_id,
            "customers": customers,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "pages": (total + limit - 1) // limit
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/rfm-analysis")
async def get_rfm_analysis():
    """Get detailed RFM analysis with segment characteristics"""
    try:
        segments_col = get_collection("customersegments")

        # RFM distribution
        rfm_pipeline = [
            {"$group": {
                "_id": {
                    "r": "$recencyScore",
                    "f": "$frequencyScore",
                    "m": "$monetaryScore"
                },
                "count": {"$sum": 1},
                "avg_revenue": {"$avg": "$monetary"}
            }},
            {"$sort": {"count": -1}}
        ]

        rfm_dist = await segments_col.aggregate(rfm_pipeline).to_list(length=None)

        # Segment characteristics
        segment_pipeline = [
            {"$group": {
                "_id": "$segment",
                "count": {"$sum": 1},
                "avg_recency": {"$avg": "$recency"},
                "avg_frequency": {"$avg": "$frequency"},
                "avg_monetary": {"$avg": "$monetary"},
                "min_monetary": {"$min": "$monetary"},
                "max_monetary": {"$max": "$monetary"},
                "total_revenue": {"$sum": "$monetary"}
            }},
            {"$sort": {"total_revenue": -1}}
        ]

        segment_chars = await segments_col.aggregate(segment_pipeline).to_list(length=None)

        return {
            "rfm_distribution": rfm_dist,
            "segment_characteristics": segment_chars
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
