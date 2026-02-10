import { MongoClient, Db, Collection, ObjectId } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "telugu_anomybot";

// MongoDB connection options for better SSL/TLS compatibility
const MONGO_OPTIONS = {
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  tls: true,
  tlsAllowInvalidCertificates: false,
  retryWrites: true,
  w: "majority" as const
};

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
  chatRating?: number; // User's rating of their chat experience (1-5)
  messageCount?: number; // Number of messages in current chat
  lastActive?: number; // Timestamp of last activity
  createdAt?: number; // Account creation timestamp
  setupStep?: string; // Track new user setup progress: 'gender', 'age', 'state', 'done'
  
  // Referral system fields
  referralCode?: string; // User's unique referral code
  referredBy?: string; // The referral code used when signing up
  referralCount?: number; // Number of users this user has referred
  premiumFromReferral?: boolean; // Whether premium was earned through referrals
  premiumExpiry?: number; // Premium expiry timestamp
}

// Extended user with isNew flag
interface UserWithNew extends User {
  isNew?: boolean;
}

// Connect to MongoDB
async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  try {
    client = new MongoClient(MONGODB_URI, MONGO_OPTIONS);
    await client.connect();
    db = client.db(DB_NAME);
    console.log("[INFO] - Connected to MongoDB");
    
    // Create indexes
    await db.collection<User>("users").createIndex({ telegramId: 1 }, { unique: true });
    await db.collection<User>("users").createIndex({ referralCode: 1 });
    await db.collection<User>("users").createIndex({ referredBy: 1 });
    
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

// Set to true to use MongoDB (requires MONGODB_URI environment variable)
// Auto-detect based on whether MONGODB_URI is set
let useMongoDB = !!process.env.MONGODB_URI;
let isFallbackMode = !useMongoDB;
let mongoConnectionFailed = false;

// Log which storage mode is being used
if (useMongoDB && !isFallbackMode) {
  console.log("[INFO] - MongoDB URI detected, will use MongoDB for data storage");
} else if (!useMongoDB) {
  console.log("[INFO] - No MongoDB URI found, using JSON file storage");
} else {
  console.log("[INFO] - MongoDB connection failed, using JSON file storage");
}

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
      console.error("[ERROR] - MongoDB getUser error:", error);
      // Don't permanently switch to fallback - MongoDB might recover
      // Continue to try JSON fallback for this operation only
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
      console.error("[ERROR] - MongoDB updateUser error:", error);
      // Continue to JSON fallback for this operation
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
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
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
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
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
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
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
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
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
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
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
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
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
      // Don't switch to fallback permanently
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
      // Don't switch to fallback permanently
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

// Increment user's total chats count
export async function incUserTotalChats(id: number): Promise<void> {
  const user = await getUser(id);
  const currentTotal = user.totalChats || 0;
  await updateUser(id, { totalChats: currentTotal + 1 });
}

// ==================== RE-ENGAGEMENT FUNCTIONS ====================

// Update user's last active timestamp
export async function updateLastActive(id: number): Promise<void> {
  await updateUser(id, { lastActive: Date.now() });
}

// Get users who haven't been active for X days
export async function getInactiveUsers(daysInactive: number): Promise<string[]> {
  const cutoffTime = Date.now() - (daysInactive * 24 * 60 * 60 * 1000);
  
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      // Find users who haven't been active since the cutoff time
      // Also include users who never had lastActive set (created before cutoff but no activity)
      const users = await collection.find({
        $or: [
          { lastActive: { $lt: cutoffTime } },
          { lastActive: { $exists: false }, createdAt: { $lt: cutoffTime } }
        ]
      }).toArray();
      return users.map((u: User) => u.telegramId.toString());
    } catch (error) {
      console.error("[ERROR] - MongoDB error getting inactive users:", error);
      // Don't switch to fallback permanently
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  if (!fs.existsSync(JSON_FILE)) return [];
  const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  
  const inactiveIds: string[] = [];
  for (const [id, userData] of Object.entries(dbObj)) {
    const user = userData as any;
    const lastActive = user.lastActive || user.createdAt || 0;
    if (lastActive < cutoffTime) {
      inactiveIds.push(id);
    }
  }
  return inactiveIds;
}

// Get user count by inactivity status
export async function getUserStats(): Promise<{
  total: number;
  activeToday: number;
  inactive7Days: number;
  inactive30Days: number;
}> {
  const allUsers = await getAllUsers();
  const now = Date.now();
  const oneDayAgo = now - (1 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
  
  let activeToday = 0;
  let inactive7Days = 0;
  let inactive30Days = 0;
  
  for (const id of allUsers) {
    const userId = parseInt(id);
    const user = await getUser(userId);
    const lastActive = user.lastActive || user.createdAt || 0;
    
    if (lastActive >= oneDayAgo) {
      activeToday++;
    }
    if (lastActive < sevenDaysAgo) {
      inactive7Days++;
    }
    if (lastActive < thirtyDaysAgo) {
      inactive30Days++;
    }
  }
  
  return {
    total: allUsers.length,
    activeToday,
    inactive7Days,
    inactive30Days
  };
}

// ==================== REFERRAL FUNCTIONS ====================

// Get user's referral count
export async function getReferralCount(userId: number): Promise<number> {
  const user = await getUser(userId);
  return user.referralCount || 0;
}

// Increment user's referral count and return new count
export async function incrementReferralCount(userId: number): Promise<number> {
  const currentCount = await getReferralCount(userId);
  const newCount = currentCount + 1;
  await updateUser(userId, { referralCount: newCount });
  return newCount;
}

// Find user by their referral code
export async function getUserByReferralCode(referralCode: string): Promise<number | null> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      const user = await collection.findOne({ referralCode });
      return user ? user.telegramId : null;
    } catch (error) {
      console.error("[ERROR] - MongoDB getUserByReferralCode error:", error);
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  if (!fs.existsSync(JSON_FILE)) return null;
  const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  
  for (const [id, userData] of Object.entries(dbObj)) {
    const user = userData as any;
    if (user.referralCode === referralCode) {
      return parseInt(id);
    }
  }
  return null;
}

// Process a referral - call when a new user joins with a referral code
export async function processReferral(referredUserId: number, referralCode: string): Promise<boolean> {
  // Find the referrer
  const referrerId = await getUserByReferralCode(referralCode);
  
  if (!referrerId) {
    console.log(`[REFERRAL] - Invalid referral code: ${referralCode}`);
    return false;
  }
  
  // Don't reward if referring yourself
  if (referrerId === referredUserId) {
    console.log(`[REFERRAL] - User ${referredUserId} tried to refer themselves`);
    return false;
  }
  
  // Check if user was already referred by someone
  const referredUser = await getUser(referredUserId);
  if (referredUser.referredBy) {
    console.log(`[REFERRAL] - User ${referredUserId} was already referred by ${referredUser.referredBy}`);
    return false;
  }
  
  // Mark the referred user as having been referred
  await updateUser(referredUserId, { referredBy: referralCode });
  
  // Increment referrer's count using atomic update to prevent race conditions
  console.log(`[REFERRAL] - About to increment referral count for referrer ${referrerId}`);
  await atomicIncrementReferralCount(referrerId);
  
  // Verify the increment
  const newCount = await getReferralCount(referrerId);
  console.log(`[REFERRAL] - Referral count for user ${referrerId} is now: ${newCount}`);
  
  console.log(`[REFERRAL] - User ${referredUserId} successfully referred by ${referrerId}`);
  return true;
}

// Atomically increment referral count to prevent race conditions
export async function atomicIncrementReferralCount(userId: number): Promise<void> {
  console.log(`[REFERRAL] - atomicIncrementReferralCount called for user ${userId}, useMongoDB=${useMongoDB}, isFallbackMode=${isFallbackMode}`);
  
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      const result = await collection.updateOne(
        { telegramId: userId },
        { $inc: { referralCount: 1 } }
      );
      console.log(`[REFERRAL] - MongoDB update result: ${result.modifiedCount} documents modified`);
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB atomicIncrementReferralCount error:", error);
    }
  }
  
  // JSON fallback - use regular increment
  console.log(`[REFERRAL] - Using JSON fallback for incrementReferralCount`);
  await incrementReferralCount(userId);
}

// Debug function to verify referral counts
export async function verifyReferralCounts(): Promise<{ accurate: boolean; discrepancies: { userId: number; stored: number; actual: number }[] }> {
  const allUsers = await getAllUsers();
  const discrepancies: { userId: number; stored: number; actual: number }[] = [];
  
  for (const id of allUsers) {
    const userId = parseInt(id);
    const user = await getUser(userId);
    const storedCount = user.referralCount || 0;
    
    // Count actual referrals
    let actualCount = 0;
    for (const otherId of allUsers) {
      const otherUser = await getUser(parseInt(otherId));
      if (otherUser.referredBy === user.referralCode) {
        actualCount++;
      }
    }
    
    if (storedCount !== actualCount) {
      discrepancies.push({ userId, stored: storedCount, actual: actualCount });
    }
  }
  
  return {
    accurate: discrepancies.length === 0,
    discrepancies
  };
}

// Fix any referral count discrepancies
export async function fixReferralCounts(): Promise<number> {
  const { discrepancies } = await verifyReferralCounts();
  let fixed = 0;
  
  for (const disc of discrepancies) {
    await updateUser(disc.userId, { referralCount: disc.actual });
    console.log(`[REFERRAL] - Fixed referral count for user ${disc.userId}: ${disc.stored} -> ${disc.actual}`);
    fixed++;
  }
  
  return fixed;
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
