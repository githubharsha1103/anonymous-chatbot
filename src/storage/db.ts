import { MongoClient, Db, Collection, ObjectId } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "anonymous_chatbot";

let client: MongoClient | null = null;
let db: Db | null = null;

// User interface
export interface User {
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
  banReason?: string | null;
  totalChats?: number;
}

// Extended user with isNew flag
interface UserWithNew extends User {
  isNew?: boolean;
}

// Connect to MongoDB
async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log("[INFO] - Connected to MongoDB");
    
    // Create indexes
    await db.collection<User>("users").createIndex({ telegramId: 1 }, { unique: true });
    
    return db;
  } catch (error) {
    console.error("[ERROR] - MongoDB connection failed:", error);
    throw error;
  }
}

async function getUsersCollection(): Promise<Collection<User>> {
  const database = await connectToDatabase();
  return database.collection<User>("users");
}

// Fallback to JSON for local development without MongoDB
const JSON_FILE = "src/storage/users.json";
const BANS_FILE = "src/storage/bans.json";

// Set to false to use JSON file storage (for Render.com without MongoDB Atlas)
// Set to true to use MongoDB (requires MONGODB_URI environment variable)
let useMongoDB = false;
let isFallbackMode = true;

// ==================== USER FUNCTIONS ====================

export async function getUser(id: number): Promise<UserWithNew> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      const user = await collection.findOne({ telegramId: id });
      
      if (user) return user;
      
      // Create new user
      const newUser: User = {
        telegramId: id,
        name: null,
        gender: null,
        age: null,
        state: null,
        premium: false,
        daily: 0,
        preference: "any",
        lastPartner: null,
        reportingPartner: null,
        reportReason: null,
        isAdminAuthenticated: false,
        chatStartTime: null,
        reportCount: 0,
        totalChats: 0
      };
      
      await collection.insertOne(newUser);
      return { ...newUser, isNew: true };
    } catch (error) {
      console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  if (!fs.existsSync(JSON_FILE)) fs.writeFileSync(JSON_FILE, "{}");
  const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  
  if (!dbObj[id]) {
    dbObj[id] = {
      name: null,
      gender: null,
      age: null,
      state: null,
      premium: false,
      daily: 0,
      preference: "any",
      lastPartner: null,
      reportingPartner: null,
      reportReason: null,
      isAdminAuthenticated: false,
      chatStartTime: null
    };
    fs.writeFileSync(JSON_FILE, JSON.stringify(dbObj, null, 2));
    return { ...dbObj[id], isNew: true };
  }
  return dbObj[id];
}

export async function updateUser(id: number, data: Partial<User>): Promise<void> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      await collection.updateOne(
        { telegramId: id },
        { $set: { ...data, telegramId: id } },
        { upsert: true }
      );
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  dbObj[id] = { ...(dbObj[id] || {}), ...data };
  fs.writeFileSync(JSON_FILE, JSON.stringify(dbObj, null, 2));
}

export async function incDaily(id: number): Promise<void> {
  const user = await getUser(id);
  await updateUser(id, { daily: (user.daily || 0) + 1 });
}

export async function setGender(id: number, gender: string): Promise<void> {
  await updateUser(id, { gender });
}

export async function getGender(id: number): Promise<string | null> {
  const user = await getUser(id);
  return user.gender;
}

export async function setState(id: number, state: string): Promise<void> {
  await updateUser(id, { state });
}

export async function getState(id: number): Promise<string | null> {
  const user = await getUser(id);
  return user.state;
}

export async function setAge(id: number, age: string): Promise<void> {
  await updateUser(id, { age });
}

export async function getAge(id: number): Promise<string | null> {
  const user = await getUser(id);
  return user.age;
}

// ==================== BAN FUNCTIONS ====================

export async function banUser(id: number): Promise<void> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<{ telegramId: number }>("bans");
      await bansCollection.insertOne({ telegramId: id });
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  const bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
  if (!bans.includes(id)) {
    bans.push(id);
    fs.writeFileSync(BANS_FILE, JSON.stringify(bans));
  }
}

export async function unbanUser(id: number): Promise<void> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<{ telegramId: number }>("bans");
      await bansCollection.deleteOne({ telegramId: id });
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  const bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
  const index = bans.indexOf(id);
  if (index > -1) {
    bans.splice(index, 1);
    fs.writeFileSync(BANS_FILE, JSON.stringify(bans));
  }
}

export async function isBanned(id: number): Promise<boolean> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<{ telegramId: number }>("bans");
      const ban = await bansCollection.findOne({ telegramId: id });
      return !!ban;
    } catch (error) {
      console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  const bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
  return bans.includes(id);
}

export async function readBans(): Promise<number[]> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<{ telegramId: number }>("bans");
      const bans = await bansCollection.find({}).toArray();
      return bans.map((b: { telegramId: number }) => b.telegramId);
    } catch (error) {
      console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  if (!fs.existsSync(BANS_FILE)) fs.writeFileSync(BANS_FILE, "[]");
  return JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
}

// ==================== USER MANAGEMENT ====================

export async function getAllUsers(): Promise<string[]> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      const users = await collection.find({}).toArray();
      return users.map((u: User) => u.telegramId.toString());
    } catch (error) {
      console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  if (!fs.existsSync(JSON_FILE)) fs.writeFileSync(JSON_FILE, "{}");
  const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  return Object.keys(dbObj);
}

export async function getReportCount(id: number): Promise<number> {
  const user = await getUser(id);
  return user.reportCount || 0;
}

export async function getBanReason(id: number): Promise<string | null> {
  const user = await getUser(id);
  return user.banReason || null;
}

export async function deleteUser(id: number, reason?: string): Promise<boolean> {
  console.log(`[DELETE_USER] - User ${id} deleted. Reason: ${reason || 'unknown'}`);
  
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      const result = await collection.deleteOne({ telegramId: id });
      return result.deletedCount > 0;
    } catch (error) {
      console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  if (dbObj[id]) {
    delete dbObj[id];
    fs.writeFileSync(JSON_FILE, JSON.stringify(dbObj, null, 2));
    return true;
  }
  return false;
}

// ==================== STATISTICS FUNCTIONS ====================

interface BotStats {
  _id?: ObjectId;
  totalChats: number;
  lastUpdated: Date;
}

// Get global chat count
export async function getTotalChats(): Promise<number> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const statsCollection = database.collection<BotStats>("stats");
      const stats = await statsCollection.findOne({});
      return stats?.totalChats || 0;
    } catch (error) {
      console.error("[ERROR] - MongoDB error getting stats:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback - read from file
  const fs = require("fs");
  const statsFile = "src/storage/stats.json";
  if (!fs.existsSync(statsFile)) return 0;
  const stats = JSON.parse(fs.readFileSync(statsFile, "utf8"));
  return stats.totalChats || 0;
}

// Increment global chat count
export async function incrementTotalChats(): Promise<void> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const statsCollection = database.collection<BotStats>("stats");
      await statsCollection.updateOne(
        {},
        { $inc: { totalChats: 1 }, $set: { lastUpdated: new Date() } },
        { upsert: true }
      );
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB error updating stats:", error);
      isFallbackMode = true;
    }
  }
  
  // JSON fallback - update file
  const fs = require("fs");
  const statsFile = "src/storage/stats.json";
  let stats = { totalChats: 0 };
  if (fs.existsSync(statsFile)) {
    stats = JSON.parse(fs.readFileSync(statsFile, "utf8"));
  }
  stats.totalChats = (stats.totalChats || 0) + 1;
  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

// Close MongoDB connection on process exit
export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log("[INFO] - MongoDB connection closed");
  }
}
