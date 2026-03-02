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
  banned?: boolean; // Whether the user is banned
  reports?: number; // Number of reports received from other users
  reportedUsers?: number[]; // Array of user IDs that this user has reported
  totalChats?: number;
  chatRating?: number; // User's rating of their chat experience (1-5)
  messageCount?: number; // Number of messages in current chat
  lastActive?: number; // Timestamp of last activity
  createdAt?: number; // Account creation timestamp
  setupStep?: string; // Track new user setup progress: 'gender', 'age', 'state', 'done'
  hasJoinedGroup?: boolean; // Track if user has joined the required group
  
  // Referral system fields
  referralCode?: string; // User's unique referral code
  referredBy?: string; // The referral code used when signing up
  referralCount?: number; // Number of users this user has referred
  referralTiersClaimed?: number[]; // Array of tier counts that have been claimed
  totalPremiumDaysFromReferral?: number; // Total premium days earned from referrals
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
    
    // Reports collection indexes for scalable report system
    await db.collection<Report>("reports").createIndex({ reportedUser: 1 }, { name: "report_user_idx" });
    await db.collection<Report>("reports").createIndex({ reportedBy: 1 }, { name: "report_reporter_idx" });
    await db.collection<Report>("reports").createIndex({ createdAt: -1 }, { name: "report_date_idx" });
    
    // Bans collection indexes for fast isBanned() queries
    await db.collection("bans").createIndex({ telegramId: 1 }, { name: "ban_telegram_idx", unique: true });
    
    // Performance indexes for admin commands and partner matching
    await db.collection<User>("users").createIndex(
      { lastActive: -1, banned: 1 },
      { name: "admin_broadcast_idx" }
    );
    await db.collection<User>("users").createIndex(
      { reports: -1 },
      { name: "reports_idx" }
    );
    await db.collection<User>("users").createIndex(
      { gender: 1, preference: 1, premium: 1, banned: 1 },
      { name: "partner_match_idx" }
    );
    await db.collection<User>("users").createIndex(
      { premium: 1, premiumExpiry: 1 },
      { name: "premium_idx" }
    );
    await db.collection<User>("users").createIndex(
      { state: 1, gender: 1 },
      { name: "location_gender_idx" }
    );
    
    console.log("[INFO] - Database indexes created successfully");
    
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
        totalChats: 0,
        reports: 0,
        banned: false
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
      chatStartTime: null,
      reports: 0,
      banned: false
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

// Ban interface with metadata
export interface Ban {
  _id?: ObjectId;
  telegramId: number;
  reason: string;
  bannedAt: number;
  bannedBy: number;
}

export async function banUser(id: number, reason: string = "Banned by admin", adminId: number = 0): Promise<void> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<Ban>("bans");
      
      // Use upsert to update existing ban or insert new
      await bansCollection.updateOne(
        { telegramId: id },
        { 
          $set: { 
            telegramId: id, 
            reason: reason,
            bannedAt: Date.now(),
            bannedBy: adminId
          } 
        },
        { upsert: true }
      );
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
    }
  }
  
  // JSON fallback - store as object with metadata
  const fs = require("fs");
  if (!fs.existsSync(BANS_FILE)) fs.writeFileSync(BANS_FILE, "{}");
  let bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
  
  // Convert array to object format if needed (migration)
  if (Array.isArray(bans)) {
    const oldBans = bans;
    bans = {};
    for (const id of oldBans) {
      bans[id] = { reason: "Migrated", bannedAt: Date.now(), bannedBy: 0 };
    }
  }
  
  bans[id] = {
    reason: reason,
    bannedAt: Date.now(),
    bannedBy: adminId
  };
  fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));
}

export async function unbanUser(id: number): Promise<void> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<Ban>("bans");
      await bansCollection.deleteOne({ telegramId: id });
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  if (!fs.existsSync(BANS_FILE)) fs.writeFileSync(BANS_FILE, "{}");
  let bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
  
  // Handle both array and object formats
  if (Array.isArray(bans)) {
    const index = bans.indexOf(id);
    if (index > -1) {
      bans.splice(index, 1);
    }
  } else if (bans[id]) {
    delete bans[id];
  }
  fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));
}

export async function isBanned(id: number): Promise<boolean> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<Ban>("bans");
      const ban = await bansCollection.findOne({ telegramId: id });
      return !!ban;
    } catch (error) {
      console.error("[ERROR] - MongoDB error:", error);
      // Don't switch to fallback permanently
    }
  }
  
  // JSON fallback
  const fs = require("fs");
  if (!fs.existsSync(BANS_FILE)) fs.writeFileSync(BANS_FILE, "{}");
  const bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
  
  // Handle both array and object formats
  if (Array.isArray(bans)) {
    return bans.includes(id);
  }
  return !!bans[id];
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
  
  // JSON fallback - with array->object migration support
  const fs = require("fs");
  
  // Initialize with object format if doesn't exist
  if (!fs.existsSync(BANS_FILE)) {
    fs.writeFileSync(BANS_FILE, "{}");
    return [];
  }
  
  let bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
  
  // Handle legacy array format migration
  if (Array.isArray(bans)) {
    console.log("[readBans] Migrating from array to object format...");
    const banObject: Record<string, { reason?: string; bannedAt?: number; bannedBy?: number }> = {};
    
    for (const userId of bans) {
      banObject[userId.toString()] = {
        reason: "Migrated from legacy format",
        bannedAt: Date.now(),
        bannedBy: 0
      };
    }
    
    // Save in new object format
    fs.writeFileSync(BANS_FILE, JSON.stringify(banObject, null, 2));
    console.log(`[readBans] Migrated ${bans.length} bans to object format`);
    return bans; // Return array for backward compatibility during migration
  }
  
  // Return array of ban IDs from object format
  return Object.keys(bans).map(key => parseInt(key, 10));
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
  // First try new scalable report storage
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getReportsCollection();
      const count = await collection.countDocuments({ reportedUser: id });
      return count;
    } catch (error) {
      console.error("[ERROR] - MongoDB getReportCount error:", error);
    }
  }
  
  // Fallback to legacy user field
  const user = await getUser(id);
  return user.reports || 0;
}

// ==================== REPORT SYSTEM (SCALABLE) ====================

// New Report interface for scalable report storage
export interface Report {
  _id?: ObjectId;
  reportedUser: number;
  reportedBy: number;
  reason: string;
  createdAt: number;
}

// Get reports collection
async function getReportsCollection(): Promise<Collection<Report>> {
  const database = await connectToDatabase();
  return database.collection<Report>("reports");
}

// Create a new report (scalable)
export async function createReport(
  reportedUserId: number,
  reportedByUserId: number,
  reason: string
): Promise<void> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getReportsCollection();
      await collection.insertOne({
        reportedUser: reportedUserId,
        reportedBy: reportedByUserId,
        reason: reason,
        createdAt: Date.now()
      });
      
      // Also update legacy field for backward compatibility
      await incrementReportCount(reportedUserId);
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB createReport error:", error);
    }
  }
  
  // JSON/file fallback - update user fields for backward compatibility
  const fs = require("fs");
  const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  
  // Store report in user's reports array
  if (!dbObj[reportedUserId]) {
    dbObj[reportedUserId] = {};
  }
  if (!dbObj[reportedUserId].reportHistory) {
    dbObj[reportedUserId].reportHistory = [];
  }
  dbObj[reportedUserId].reportHistory.push({
    reportedBy: reportedByUserId,
    reason: reason,
    createdAt: Date.now()
  });
  
  // Update legacy fields
  const currentReports = dbObj[reportedUserId]?.reports || 0;
  dbObj[reportedUserId].reports = currentReports + 1;
  dbObj[reportedUserId].reportReason = reason; // Keep for backward compatibility
  dbObj[reportedUserId].reportingPartner = reportedByUserId;
  
  fs.writeFileSync(JSON_FILE, JSON.stringify(dbObj, null, 2));
}

// Get all reports grouped by user (for admin view - scalable)
export async function getGroupedReports(limit: number = 10): Promise<{ userId: number; count: number; latestReason: string; reporters: number[] }[]> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getReportsCollection();
      const pipeline = [
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$reportedUser",
            count: { $sum: 1 },
            latestReason: { $first: "$reason" },
            reporters: { $push: "$reportedBy" }
          }
        },
        { $sort: { count: -1 } },
        { $limit: limit },
        {
          $project: {
            userId: "$_id",
            count: 1,
            latestReason: 1,
            reporters: 1
          }
        }
      ];
      
      const results = await collection.aggregate(pipeline).toArray();
      return results.map(r => ({
        userId: r.userId,
        count: r.count,
        latestReason: r.latestReason,
        reporters: r.reporters || []
      }));
    } catch (error) {
      console.error("[ERROR] - MongoDB getGroupedReports error:", error);
    }
  }
  
  // Fallback: iterate through users (less efficient but works)
  const allUsers = await getAllUsers();
  const userReports: { userId: number; count: number; latestReason: string; reporters: number[] }[] = [];
  
  for (const id of allUsers) {
    const userId = parseInt(id);
    const reports = await getReportCount(userId);
    if (reports > 0) {
      const user = await getUser(userId);
      userReports.push({
        userId,
        count: reports,
        latestReason: user.reportReason || "No reason",
        reporters: []
      });
    }
  }
  
  // Sort by count descending and limit
  userReports.sort((a, b) => b.count - a.count);
  return userReports.slice(0, limit);
}

// Get full report history for a specific user
export async function getUserReports(userId: number): Promise<Report[]> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getReportsCollection();
      const reports = await collection
        .find({ reportedUser: userId })
        .sort({ createdAt: -1 })
        .toArray();
      return reports;
    } catch (error) {
      console.error("[ERROR] - MongoDB getUserReports error:", error);
    }
  }
  
  // Fallback: read from user data
  const user = await getUser(userId);
  const history = (user as any).reportHistory || [];
  return history.map((r: any) => ({
    reportedUser: userId,
    reportedBy: r.reportedBy,
    reason: r.reason,
    createdAt: r.createdAt
  }));
}

// Atomically increment user's report count to prevent race conditions
export async function incrementReportCount(userId: number): Promise<number> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      await collection.updateOne(
        { telegramId: userId },
        { $inc: { reports: 1 } }
      );
      const user = await getUser(userId);
      return user.reports || 0;
    } catch (error) {
      console.error("[ERROR] - MongoDB incrementReportCount error:", error);
    }
  }
  
  // JSON/file fallback with read-modify-write
  const fs = require("fs");
  const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  const currentReports = dbObj[userId]?.reports || 0;
  dbObj[userId] = { ...(dbObj[userId] || {}), reports: currentReports + 1 };
  fs.writeFileSync(JSON_FILE, JSON.stringify(dbObj, null, 2));
  return currentReports + 1;
}

export async function getBanReason(id: number): Promise<string | null> {
  // First try new bans collection with metadata
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<Ban>("bans");
      const ban = await bansCollection.findOne({ telegramId: id });
      if (ban) {
        return ban.reason;
      }
      return null;
    } catch (error) {
      console.error("[ERROR] - MongoDB getBanReason error:", error);
    }
  }
  
  // JSON fallback - check object format
  const fs = require("fs");
  if (!fs.existsSync(BANS_FILE)) fs.writeFileSync(BANS_FILE, "{}");
  const bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
  
  // Handle both array (legacy) and object (new) formats
  if (Array.isArray(bans)) {
    return bans.includes(id) ? "Banned" : null;
  }
  
  return bans[id]?.reason || null;
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

// Referral tier configuration
const REFERRAL_TIERS = [
    { count: 3, premiumDays: 1 },
    { count: 7, premiumDays: 3 },
    { count: 15, premiumDays: 7 },
    { count: 30, premiumDays: 14 },
    { count: 50, premiumDays: 30 }
];

// Calculate premium days earned based on referral count
function calculatePremiumDays(referralCount: number): number {
    let totalDays = 0;
    let previousCount = 0;
    
    for (const tier of REFERRAL_TIERS) {
        if (referralCount >= tier.count) {
            // Calculate incremental days for this tier
            const incrementalCount = tier.count - previousCount;
            // Simplified: each tier gives its full premium days when reached
            totalDays = tier.premiumDays;
            previousCount = tier.count;
        } else if (referralCount > previousCount) {
            // Partially completed tier - no partial rewards in this model
            break;
        }
    }
    
    return totalDays;
}

// Get detailed referral statistics
interface ReferralStats {
    total: number;
    active: number;
    premiumDaysEarned: number;
    currentTier: number;
}

export async function getReferralStats(userId: number): Promise<ReferralStats> {
    const user = await getUser(userId);
    const referralCount = user.referralCount || 0;
    
    // Count active referrals (users who have been active in last 7 days)
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let activeCount = 0;
    
    // Use optimized MongoDB queries instead of nested loops
    if (useMongoDB && !isFallbackMode) {
        try {
            const collection = await getUsersCollection();
            
            // Count total referrals using referredBy field
            const totalReferred = await collection.countDocuments({ 
                referredBy: user.referralCode 
            });
            
            // Count active referrals (active in last 7 days)
            activeCount = await collection.countDocuments({
                referredBy: user.referralCode,
                lastActive: { $gte: sevenDaysAgo }
            });
            
            // Return with Mongo-optimized counts
            const premiumDaysEarned = user.totalPremiumDaysFromReferral || 0;
            
            let currentTier = 0;
            for (let i = REFERRAL_TIERS.length - 1; i >= 0; i--) {
                if (totalReferred >= REFERRAL_TIERS[i].count) {
                    currentTier = i + 1;
                    break;
                }
            }
            
            return {
                total: totalReferred,
                active: activeCount,
                premiumDaysEarned,
                currentTier
            };
        } catch (error) {
            console.error("[ERROR] - MongoDB getReferralStats error:", error);
        }
    }
    
    // JSON fallback - use existing nested loop (less efficient but works)
    const allUsers = await getAllUsers();
    
    for (const id of allUsers) {
        const referredUser = await getUser(parseInt(id));
        if (referredUser.referredBy === user.referralCode) {
            const lastActive = referredUser.lastActive || referredUser.createdAt || 0;
            if (lastActive >= sevenDaysAgo) {
                activeCount++;
            }
        }
    }
    
    // Get premium days earned from user record
    const premiumDaysEarned = user.totalPremiumDaysFromReferral || 0;
    
    // Determine current tier
    let currentTier = 0;
    for (let i = REFERRAL_TIERS.length - 1; i >= 0; i--) {
        if (referralCount >= REFERRAL_TIERS[i].count) {
            currentTier = i + 1;
            break;
        }
    }
    
    return {
        total: referralCount,
        active: activeCount,
        premiumDaysEarned,
        currentTier
    };
}

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

// Get all referral statistics in ONE query (optimized for admin panel)
export async function getAllReferralStats(): Promise<{ totalReferrals: number; usersWithReferrals: number }> {
    if (useMongoDB && !isFallbackMode) {
        try {
            const collection = await getUsersCollection();
            
            // Single aggregation query to get both metrics
            const result = await collection.aggregate([
                {
                    $match: { referralCount: { $gt: 0 } }
                },
                {
                    $group: {
                        _id: null,
                        totalReferrals: { $sum: "$referralCount" },
                        usersWithReferrals: { $sum: 1 }
                    }
                }
            ]).toArray();
            
            if (result.length > 0) {
                return {
                    totalReferrals: result[0].totalReferrals || 0,
                    usersWithReferrals: result[0].usersWithReferrals || 0
                };
            }
            
            return { totalReferrals: 0, usersWithReferrals: 0 };
        } catch (error) {
            console.error("[ERROR] - MongoDB getAllReferralStats error:", error);
        }
    }
    
    // JSON fallback - optimized (single pass through users)
    const allUsers = await getAllUsers();
    let totalReferrals = 0;
    let usersWithReferrals = 0;
    
    for (const id of allUsers) {
        const user = await getUser(parseInt(id));
        const referralCount = user?.referralCount || 0;
        if (referralCount > 0) {
            totalReferrals += referralCount;
            usersWithReferrals++;
        }
    }
    
    return { totalReferrals, usersWithReferrals };
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
  console.log(`[REFERRAL] - processReferral called: referredUserId=${referredUserId}, referralCode=${referralCode}`);
  
  // Find the referrer
  const referrerId = await getUserByReferralCode(referralCode);
  console.log(`[REFERRAL] - getUserByReferralCode result: referrerId=${referrerId}`);
  
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
  console.log(`[REFERRAL] - referredUser.referredBy: ${referredUser.referredBy}`);
  
  if (referredUser.referredBy) {
    console.log(`[REFERRAL] - User ${referredUserId} was already referred by ${referredUser.referredBy}`);
    return false;
  }
  
  // Mark the referred user as having been referred
  await updateUser(referredUserId, { referredBy: referralCode });
  console.log(`[REFERRAL] - Marked user ${referredUserId} as referred by ${referralCode}`);
  
  // Get referrer's current state before increment
  const referrer = await getUser(referrerId);
  const oldCount = referrer.referralCount || 0;
  const claimedTiers = referrer.referralTiersClaimed || [];
  console.log(`[REFERRAL] - Referrer ${referrerId} current count: ${oldCount}`);
  
  // Increment referrer's count using atomic update
  console.log(`[REFERRAL] - About to increment referral count for referrer ${referrerId}`);
  await atomicIncrementReferralCount(referrerId);
  
  // Verify and get new count
  const newCount = await getReferralCount(referrerId);
  console.log(`[REFERRAL] - Referral count for user ${referrerId} is now: ${newCount}`);
  
  // Check for newly reached tiers and award premium
  let newPremiumDays = 0;
  const newlyClaimedTiers: number[] = [];
  
  for (let i = 0; i < REFERRAL_TIERS.length; i++) {
    const tier = REFERRAL_TIERS[i];
    const tierCount = tier.count;
    
    // If this tier is newly reached (old count < tier <= new count)
    if (oldCount < tierCount && newCount >= tierCount) {
      if (!claimedTiers.includes(tierCount)) {
        // Award premium days for this tier
        newPremiumDays += tier.premiumDays;
        claimedTiers.push(tierCount);
        newlyClaimedTiers.push(tierCount);
        console.log(`[REFERRAL] - User ${referrerId} reached tier ${tierCount}! Awarding ${tier.premiumDays} premium days`);
      }
    }
  }
  
  // Update referrer with new premium days and claimed tiers
  if (newPremiumDays > 0) {
    const currentPremiumDays = referrer.totalPremiumDaysFromReferral || 0;
    const newTotalPremiumDays = currentPremiumDays + newPremiumDays;
    
    // Extend premium expiry
    const currentExpiry = referrer.premiumExpiry || 0;
    const newExpiry = Math.max(currentExpiry, Date.now()) + (newPremiumDays * 24 * 60 * 60 * 1000);
    
    await updateUser(referrerId, {
      premium: true,
      premiumExpiry: newExpiry,
      referralTiersClaimed: claimedTiers,
      totalPremiumDaysFromReferral: newTotalPremiumDays
    });
    
    console.log(`[REFERRAL] - User ${referrerId} earned ${newPremiumDays} premium days! Total: ${newTotalPremiumDays} days`);
    
    // Notify the referrer (optional - could send a message)
    console.log(`[REFERRAL] - Tier rewards: ${newlyClaimedTiers.join(", ")} claimed`);
  }
  
  console.log(`[REFERRAL] - SUCCESS: User ${referredUserId} successfully referred by ${referrerId}`);
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
