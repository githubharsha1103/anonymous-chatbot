/**
 * Migration Script: Import JSON users to MongoDB
 * Run this ONCE to migrate existing users from JSON to MongoDB
 * 
 * Usage: npx ts-node migrateToMongoDB.ts
 */

import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import fs from "fs";
import path from "path";

// Read from environment variables (loaded from .env)
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "telugu_anomybot";
const JSON_FILE = "src/storage/users.json";

interface UserData {
  name: string | null;
  gender: string | null;
  age: string | null;
  state: string | null;
  premium: boolean;
  daily: number;
  preference: string;
  lastPartner: number | null;
  reportingPartner: number | null;
  reportReason: string | null;
  isAdminAuthenticated: boolean;
  chatStartTime: number | null;
  isNew?: boolean;
}

interface MongoUser {
  _id?: ObjectId;
  telegramId: number;
  name: string | null;
  gender: string | null;
  age: string | null;
  state: string | null;
  premium: boolean;
  daily: number;
  preference: string;
  lastPartner: number | null;
  reportingPartner: number | null;
  reportReason: string | null;
  isAdminAuthenticated: boolean;
  chatStartTime: number | null;
  reportCount?: number;
  totalChats?: number;
}

async function migrate() {
  console.log("🔄 Starting migration from JSON to MongoDB...\n");

  // Check if JSON file exists
  if (!fs.existsSync(JSON_FILE)) {
    console.log("❌ JSON file not found:", JSON_FILE);
    process.exit(1);
  }

  // Read JSON file
  const jsonData = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  const userIds = Object.keys(jsonData);

  if (userIds.length === 0) {
    console.log("✅ No users to migrate (JSON file is empty)");
    return;
  }

  console.log(`📊 Found ${userIds.length} users in JSON file\n`);

  // Connect to MongoDB
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB\n");

    const db = client.db(DB_NAME);
    const collection = db.collection<MongoUser>("users");

    // Create unique index on telegramId
    await collection.createIndex({ telegramId: 1 }, { unique: true });

    // Migrate users
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const id of userIds) {
      const userId = parseInt(id);
      const userData = jsonData[id] as UserData;

      try {
        // Check if user already exists in MongoDB
        const existing = await collection.findOne({ telegramId: userId });
        
        if (existing) {
          console.log(`  ⏭️  User ${userId} already exists, skipping...`);
          skipped++;
          continue;
        }

        // Insert user into MongoDB
        const mongoUser: MongoUser = {
          telegramId: userId,
          name: userData.name,
          gender: userData.gender,
          age: userData.age,
          state: userData.state,
          premium: userData.premium,
          daily: userData.daily || 0,
          preference: userData.preference || "any",
          lastPartner: userData.lastPartner,
          reportingPartner: userData.reportingPartner,
          reportReason: userData.reportReason,
          isAdminAuthenticated: userData.isAdminAuthenticated,
          chatStartTime: userData.chatStartTime,
          reportCount: 0,
          totalChats: 0
        };

        await collection.insertOne(mongoUser);
        console.log(`  ✅ Migrated user ${userId} (${userData.name || "Unknown"})`);
        migrated++;
      } catch (error: any) {
        console.log(`  ❌ Error migrating user ${userId}: ${error.message}`);
        errors++;
      }
    }

    console.log(`\n📈 Migration Summary:`);
    console.log(`   Migrated: ${migrated}`);
    console.log(`   Skipped (already exists): ${skipped}`);
    console.log(`   Errors: ${errors}`);

    // Show total users in MongoDB
    const totalInMongo = await collection.countDocuments();
    console.log(`\n📊 Total users in MongoDB: ${totalInMongo}`);

  } catch (error: any) {
    console.error("❌ MongoDB connection error:", error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log("\n✅ Migration complete!");
  }
}

migrate();
