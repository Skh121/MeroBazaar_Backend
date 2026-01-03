"""
MongoDB connection for ML Service
"""

import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

class Database:
    client: AsyncIOMotorClient = None
    db = None

db = Database()

async def connect_to_mongo():
    """Connect to MongoDB"""
    mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017/merobazaar")
    db.client = AsyncIOMotorClient(mongo_uri)
    db.db = db.client.get_default_database()
    print(f"Connected to MongoDB: {db.db.name}")

async def close_mongo_connection():
    """Close MongoDB connection"""
    if db.client:
        db.client.close()
        print("Closed MongoDB connection")

def get_database():
    """Get database instance"""
    return db.db

def get_collection(collection_name: str):
    """Get a collection from the database"""
    return db.db[collection_name]
