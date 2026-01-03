"""
MeroBazaar ML Service
FastAPI application for ML-powered analytics
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
from dotenv import load_dotenv

from routers import recommendations, segmentation, forecasting, pricing
from database import connect_to_mongo, close_mongo_connection

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_to_mongo()
    yield
    # Shutdown
    await close_mongo_connection()

app = FastAPI(
    title="MeroBazaar ML Service",
    description="Machine Learning APIs for recommendations, segmentation, forecasting, and pricing",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("BACKEND_URL", "http://localhost:5000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(recommendations.router, prefix="/recommendations", tags=["Recommendations"])
app.include_router(segmentation.router, prefix="/segmentation", tags=["Customer Segmentation"])
app.include_router(forecasting.router, prefix="/forecasting", tags=["Demand Forecasting"])
app.include_router(pricing.router, prefix="/pricing", tags=["Dynamic Pricing"])

@app.get("/")
async def root():
    return {"message": "MeroBazaar ML Service is running", "status": "healthy"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ml-analytics"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
