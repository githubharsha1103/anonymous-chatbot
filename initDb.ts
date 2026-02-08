/**
 * Script to initialize MongoDB database and collection
 * Run this to create the users collection if it doesn't exist
 */
import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "anonymous_chatbot";

async function initializeDatabase() {
  console.log("Connecting to MongoDB...");
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log("✓ Connected to MongoDB");
    
    const db = client.db(DB_NAME);
    console.log(`✓ Using database: ${DB_NAME}`);
    
    // Create users collection with index
    const usersCollection = db.collection("users");
    console.log("✓ Users collection accessed/created");
    
    // Create unique index on telegramId
    await usersCollection.createIndex({ telegramId: 1 }, { unique: true });
    console.log("✓ Created unique index on telegramId");
    
    // Create index on referralCode for faster lookups
    await usersCollection.createIndex({ referralCode: 1 });
    console.log("✓ Created index on referralCode");
    
    // Create index on referredBy for tracking referrals
    await usersCollection.createIndex({ referredBy: 1 });
    console.log("✓ Created index on referredBy");
    
    // Create bans collection with index
    const bansCollection = db.collection("bans");
    console.log("✓ Bans collection accessed/created");
    
    await bansCollection.createIndex({ telegramId: 1 }, { unique: true });
    console.log("✓ Created unique index on telegramId for bans");
    
    // Create stats collection
    const statsCollection = db.collection("stats");
    console.log("✓ Stats collection accessed/created");
    
    // Check current user count
    const userCount = await usersCollection.countDocuments();
    console.log(`\n📊 Current user count in database: ${userCount}`);
    
    // Check if data is actually being saved
    console.log("\n✅ Database initialization complete!");
    console.log("   - Database: " + DB_NAME);
    console.log("   - Collections: users, bans, stats");
    console.log("   - Ready to store user data persistently");
    
  } catch (error) {
    console.error("✗ Error initializing database:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("\nConnection closed.");
  }
}

initializeDatabase();
