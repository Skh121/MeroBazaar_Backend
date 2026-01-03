"""
Recommendation System using Collaborative Filtering
with Implicit Feedback and Cosine Similarity
"""

from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from bson import ObjectId
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.metrics.pairwise import cosine_similarity
from datetime import datetime, timedelta

from database import get_collection

router = APIRouter()

class RecommendationEngine:
    """Collaborative filtering recommendation engine with implicit feedback"""

    def __init__(self):
        self.user_item_matrix = None
        self.user_similarity_matrix = None
        self.item_similarity_matrix = None
        self.user_index_map = {}
        self.item_index_map = {}
        self.index_user_map = {}
        self.index_item_map = {}
        self.last_updated = None

    async def build_matrices(self):
        """Build user-item interaction matrices from database"""
        interactions_col = get_collection("userproductinteractions")

        # Fetch all interactions
        interactions = await interactions_col.find({}).to_list(length=None)

        if not interactions:
            return False

        # Build index mappings
        users = list(set(str(i["user"]) for i in interactions))
        items = list(set(str(i["product"]) for i in interactions))

        self.user_index_map = {u: idx for idx, u in enumerate(users)}
        self.item_index_map = {i: idx for idx, i in enumerate(items)}
        self.index_user_map = {idx: u for u, idx in self.user_index_map.items()}
        self.index_item_map = {idx: i for i, idx in self.item_index_map.items()}

        # Build sparse user-item matrix
        rows, cols, data = [], [], []

        for interaction in interactions:
            user_idx = self.user_index_map[str(interaction["user"])]
            item_idx = self.item_index_map[str(interaction["product"])]
            score = interaction.get("interactionScore", 1)

            rows.append(user_idx)
            cols.append(item_idx)
            data.append(score)

        self.user_item_matrix = csr_matrix(
            (data, (rows, cols)),
            shape=(len(users), len(items))
        )

        # Compute similarity matrices
        # User-user similarity for user-based CF
        self.user_similarity_matrix = cosine_similarity(self.user_item_matrix)

        # Item-item similarity for item-based CF
        self.item_similarity_matrix = cosine_similarity(self.user_item_matrix.T)

        self.last_updated = datetime.utcnow()
        return True

    async def ensure_matrices_built(self, max_age_hours: int = 1):
        """Ensure matrices are built and not too stale"""
        if (self.user_item_matrix is None or
            self.last_updated is None or
            datetime.utcnow() - self.last_updated > timedelta(hours=max_age_hours)):
            await self.build_matrices()

    async def get_user_recommendations(
        self,
        user_id: str,
        n_recommendations: int = 10,
        method: str = "hybrid"
    ) -> List[str]:
        """Get personalized recommendations for a user"""
        await self.ensure_matrices_built()

        if user_id not in self.user_index_map:
            # Cold start: return popular items
            return await self.get_popular_items(n_recommendations)

        user_idx = self.user_index_map[user_id]

        if method == "user_based":
            return self._user_based_recommendations(user_idx, n_recommendations)
        elif method == "item_based":
            return await self._item_based_recommendations(user_idx, n_recommendations)
        else:  # hybrid
            user_recs = self._user_based_recommendations(user_idx, n_recommendations)
            item_recs = await self._item_based_recommendations(user_idx, n_recommendations)

            # Combine and deduplicate
            combined = []
            seen = set()
            for rec in user_recs + item_recs:
                if rec not in seen:
                    combined.append(rec)
                    seen.add(rec)
                if len(combined) >= n_recommendations:
                    break

            return combined

    def _user_based_recommendations(self, user_idx: int, n: int) -> List[str]:
        """User-based collaborative filtering"""
        if self.user_similarity_matrix is None:
            return []

        # Get similar users
        similar_users = np.argsort(self.user_similarity_matrix[user_idx])[::-1][1:11]

        # Get items the user hasn't interacted with
        user_interactions = set(self.user_item_matrix[user_idx].nonzero()[1])

        # Score items based on similar users' interactions
        item_scores = {}
        for similar_user_idx in similar_users:
            similarity = self.user_similarity_matrix[user_idx, similar_user_idx]
            similar_user_items = self.user_item_matrix[similar_user_idx].nonzero()[1]

            for item_idx in similar_user_items:
                if item_idx not in user_interactions:
                    score = similarity * self.user_item_matrix[similar_user_idx, item_idx]
                    item_scores[item_idx] = item_scores.get(item_idx, 0) + score

        # Sort and return top N
        sorted_items = sorted(item_scores.items(), key=lambda x: x[1], reverse=True)[:n]
        return [self.index_item_map[idx] for idx, _ in sorted_items]

    async def _item_based_recommendations(self, user_idx: int, n: int) -> List[str]:
        """Item-based collaborative filtering"""
        if self.item_similarity_matrix is None:
            return []

        # Get items the user has interacted with
        user_items = self.user_item_matrix[user_idx].nonzero()[1]
        user_interactions = set(user_items)

        # Score items based on similarity to user's items
        item_scores = {}
        for user_item_idx in user_items:
            user_item_score = self.user_item_matrix[user_idx, user_item_idx]

            # Get similar items
            similar_items = np.argsort(self.item_similarity_matrix[user_item_idx])[::-1][1:21]

            for similar_item_idx in similar_items:
                if similar_item_idx not in user_interactions:
                    similarity = self.item_similarity_matrix[user_item_idx, similar_item_idx]
                    score = similarity * user_item_score
                    item_scores[similar_item_idx] = item_scores.get(similar_item_idx, 0) + score

        sorted_items = sorted(item_scores.items(), key=lambda x: x[1], reverse=True)[:n]
        return [self.index_item_map[idx] for idx, _ in sorted_items]

    async def get_similar_items(self, item_id: str, n: int = 6) -> List[str]:
        """Get items similar to a given item"""
        await self.ensure_matrices_built()

        if item_id not in self.item_index_map:
            # Return items from same category
            products_col = get_collection("products")
            product = await products_col.find_one({"_id": ObjectId(item_id)})

            if product:
                similar = await products_col.find({
                    "_id": {"$ne": ObjectId(item_id)},
                    "category": product.get("category"),
                    "status": "active"
                }).limit(n).to_list(length=n)
                return [str(p["_id"]) for p in similar]
            return []

        item_idx = self.item_index_map[item_id]

        # Get most similar items
        similarities = self.item_similarity_matrix[item_idx]
        similar_indices = np.argsort(similarities)[::-1][1:n+1]

        return [self.index_item_map[idx] for idx in similar_indices]

    async def get_popular_items(self, n: int = 10) -> List[str]:
        """Get most popular items (fallback for cold start)"""
        interactions_col = get_collection("userproductinteractions")

        pipeline = [
            {"$group": {
                "_id": "$product",
                "total_score": {"$sum": "$interactionScore"}
            }},
            {"$sort": {"total_score": -1}},
            {"$limit": n}
        ]

        results = await interactions_col.aggregate(pipeline).to_list(length=n)
        return [str(r["_id"]) for r in results]

# Global recommendation engine instance
rec_engine = RecommendationEngine()

@router.get("/{user_id}")
async def get_recommendations(
    user_id: str,
    limit: int = Query(10, ge=1, le=50),
    type: str = Query("hybrid", regex="^(user_based|item_based|hybrid)$")
):
    """
    Get personalized product recommendations for a user.

    - **user_id**: The user's MongoDB ObjectId
    - **limit**: Number of recommendations to return (1-50)
    - **type**: Recommendation algorithm type (user_based, item_based, hybrid)
    """
    try:
        recommendations = await rec_engine.get_user_recommendations(
            user_id,
            n_recommendations=limit,
            method=type
        )

        # Fetch product details
        products_col = get_collection("products")
        product_ids = [ObjectId(pid) for pid in recommendations if ObjectId.is_valid(pid)]

        products = await products_col.find({
            "_id": {"$in": product_ids},
            "status": "active"
        }).to_list(length=limit)

        return {
            "recommendations": recommendations,
            "products": [{
                "id": str(p["_id"]),
                "name": p.get("name"),
                "price": p.get("price"),
                "category": p.get("category"),
                "images": p.get("images", [])
            } for p in products],
            "type": type,
            "count": len(recommendations)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/similar/{product_id}")
async def get_similar_products(
    product_id: str,
    limit: int = Query(6, ge=1, le=20)
):
    """
    Get products similar to a given product.

    - **product_id**: The product's MongoDB ObjectId
    - **limit**: Number of similar products to return (1-20)
    """
    try:
        similar_ids = await rec_engine.get_similar_items(product_id, n=limit)

        # Fetch product details
        products_col = get_collection("products")
        product_ids = [ObjectId(pid) for pid in similar_ids if ObjectId.is_valid(pid)]

        products = await products_col.find({
            "_id": {"$in": product_ids},
            "status": "active"
        }).to_list(length=limit)

        return {
            "similar_products": similar_ids,
            "products": [{
                "id": str(p["_id"]),
                "name": p.get("name"),
                "price": p.get("price"),
                "category": p.get("category"),
                "images": p.get("images", [])
            } for p in products],
            "count": len(similar_ids)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rebuild")
async def rebuild_recommendation_model():
    """
    Manually trigger rebuilding of recommendation matrices.
    This is useful after significant data changes.
    """
    try:
        success = await rec_engine.build_matrices()
        if success:
            return {
                "success": True,
                "message": "Recommendation matrices rebuilt successfully",
                "timestamp": rec_engine.last_updated.isoformat()
            }
        else:
            return {
                "success": False,
                "message": "No interaction data available to build matrices"
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/popular/items")
async def get_popular_products(limit: int = Query(10, ge=1, le=50)):
    """Get most popular products based on interaction scores"""
    try:
        popular_ids = await rec_engine.get_popular_items(n=limit)

        products_col = get_collection("products")
        product_ids = [ObjectId(pid) for pid in popular_ids if ObjectId.is_valid(pid)]

        products = await products_col.find({
            "_id": {"$in": product_ids},
            "status": "active"
        }).to_list(length=limit)

        return {
            "popular_products": popular_ids,
            "products": [{
                "id": str(p["_id"]),
                "name": p.get("name"),
                "price": p.get("price"),
                "category": p.get("category"),
                "images": p.get("images", [])
            } for p in products],
            "count": len(popular_ids)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
