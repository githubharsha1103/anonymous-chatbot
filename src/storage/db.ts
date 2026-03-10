import { MongoClient, Db, Collection, ObjectId } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "telugu_anomybot";

// MongoDB connection options for better SSL/TLS compatibility
const isSrvConnection = MONGODB_URI.startsWith("mongodb+srv://");
const MONGO_OPTIONS = {
  maxPoolSize: 5,
  minPoolSize: 1,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  ...(isSrvConnection ? {
    tls: true,
    tlsAllowInvalidCertificates: false
  } : {}),
  retryWrites: true,
  w: "majority" as const
};

// ---------- JSON FILE CONCURRENCY LOCK ----------
// Many fallback operations use the filesystem. to avoid
// race conditions we serialize access with a simple mutex.

class JsonMutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    return new Promise(resolve => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

const jsonMutex = new JsonMutex();

import { access, readFile, writeFile } from "fs/promises";

async function readJson<T = Record<string, unknown>>(path: string): Promise<T> {
  await jsonMutex.acquire();
  try {
    try {
      await access(path);
    } catch {
      await writeFile(path, "{}", "utf8");
    }
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } finally {
    jsonMutex.release();
  }
}

async function writeJson<T>(path: string, data: T): Promise<void> {
  await jsonMutex.acquire();
  try {
    await writeFile(path, JSON.stringify(data, null, 2), "utf8");
  } finally {
    jsonMutex.release();
  }
}

// --------------------------------------------------


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
  blockedUsers?: number[]; // Personal blocklist for premium users
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
  premiumExpires?: number | null; // Stars premium expiry timestamp
  processedPaymentChargeIds?: string[]; // Idempotency guard for successful payments
}

export type PremiumOrderStatus = "pending" | "paid" | "failed" | "expired";

export interface PremiumPaymentOrder {
  _id?: ObjectId;
  orderId: string;
  userId: number;
  planId: string;
  premiumDays: number;
  starsAmount: number;
  currency: "XTR";
  status: PremiumOrderStatus;
  entitlementApplied: boolean;
  createdAt: number;
  paidAt?: number;
  telegramPaymentChargeId?: string;
  providerPaymentChargeId?: string;
}

// Extended user with isNew flag
interface UserWithNew extends User {
  isNew?: boolean;
}

interface LegacyReportEntry {
  reportedBy: number;
  reason: string;
  createdAt: number;
}

type JsonUserRecord = Partial<User> & { reportHistory?: LegacyReportEntry[] };
type JsonUsersDb = Record<string, JsonUserRecord>;
type JsonStats = { totalChats?: number };
type JsonPaymentOrdersDb = Record<string, PremiumPaymentOrder>;

const AGE_RANGE_TO_AVERAGE: Record<string, string> = {
  "13-17": "15",
  "18-25": "22",
  "26-40": "33",
  "40+": "45"
};

export function normalizeAgeValue(age: string | null | undefined): string | null {
  if (!age) {
    return null;
  }

  const trimmed = age.trim();
  return AGE_RANGE_TO_AVERAGE[trimmed] || trimmed;
}

// Connect to MongoDB
async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  try {
    client = new MongoClient(MONGODB_URI, MONGO_OPTIONS);
    await client.connect();
    db = client.db(DB_NAME);
    mongoConnectionFailed = false;
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

    // Premium payment orders indexes
    await db.collection<PremiumPaymentOrder>("premium_orders").createIndex(
      { orderId: 1 },
      { name: "premium_order_id_idx", unique: true }
    );
    await db.collection<PremiumPaymentOrder>("premium_orders").createIndex(
      { userId: 1, status: 1, createdAt: -1 },
      { name: "premium_order_user_status_idx" }
    );
    
    console.log("[INFO] - Database indexes created successfully");
    
    return db;
  } catch (error) {
    mongoConnectionFailed = true;
    console.error("[ERROR] - MongoDB connection failed:", error);
    throw error;
  }
}

async function getUsersCollection(): Promise<Collection<User>> {
  const database = await connectToDatabase();
  return database.collection<User>("users");
}

async function getPremiumOrdersCollection(): Promise<Collection<PremiumPaymentOrder>> {
  const database = await connectToDatabase();
  return database.collection<PremiumPaymentOrder>("premium_orders");
}

// Fallback to JSON for local development without MongoDB
const JSON_FILE = "src/storage/users.json";
const BANS_FILE = "src/storage/bans.json";
const PAYMENT_ORDERS_FILE = "src/storage/paymentOrders.json";

// Set to true to use MongoDB (requires MONGODB_URI environment variable)
// Auto-detect based on whether MONGODB_URI is set
const useMongoDB = !!process.env.MONGODB_URI;
const isFallbackMode = !useMongoDB;
let mongoConnectionFailed = false;

// Track database health status for external monitoring
export function getDatabaseStatus(): { mode: string; healthy: boolean; message: string } {
  if (!useMongoDB || isFallbackMode) {
    return {
      mode: 'json',
      healthy: true,
      message: 'Using JSON file storage (no MongoDB configured)'
    };
  }
  
  if (mongoConnectionFailed) {
    return {
      mode: 'mongodb',
      healthy: false,
      message: 'MongoDB connection failed, using JSON fallback'
    };
  }
  
  return {
    mode: 'mongodb',
    healthy: true,
    message: 'Connected to MongoDB'
  };
}

/**
 * Ping MongoDB to verify connection is alive
 * Returns true if connection is healthy
 */
export async function pingDatabase(): Promise<boolean> {
  if (!useMongoDB || isFallbackMode || mongoConnectionFailed) {
    return false;
  }
  
  if (!client) {
    return false;
  }
  
  try {
    const db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

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
      
      if (user) {
        const effectiveExpiry = user.premiumExpires || user.premiumExpiry || 0;
        if (user.premium && effectiveExpiry > 0 && effectiveExpiry <= Date.now()) {
          await updateUser(id, { premium: false });
          user.premium = false;
        }
        const normalizedAge = normalizeAgeValue(user.age);
        if (normalizedAge !== user.age) {
          await updateUser(id, { age: normalizedAge });
          return { ...user, age: normalizedAge };
        }
        return user;
      }
      
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
        blockedUsers: [],
        isAdminAuthenticated: false,
        chatStartTime: null,
        reportCount: 0,
        totalChats: 0,
        reports: 0,
        banned: false,
        premiumExpires: null,
        processedPaymentChargeIds: []
      };
      
      await collection.insertOne(newUser);
      return { ...newUser, isNew: true };
    } catch (error) {
      console.error("[ERROR] - MongoDB getUser error:", error);
      // Don't permanently switch to fallback - MongoDB might recover
      // Continue to try JSON fallback for this operation only
    }
  }
  
  // JSON fallback (thread-safe via mutex helpers)
  const dbObj = await readJson<Record<string, unknown>>(JSON_FILE);
  
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
      blockedUsers: [],
      isAdminAuthenticated: false,
      chatStartTime: null,
      reports: 0,
      banned: false,
      premiumExpires: null,
      processedPaymentChargeIds: []
    };
    await writeJson(JSON_FILE, dbObj);
    return { ...(dbObj[id] as Record<string, unknown>), isNew: true } as UserWithNew;
  }
  const user = dbObj[id] as UserWithNew;
  const effectiveExpiry = user.premiumExpires || user.premiumExpiry || 0;
  if (user.premium && effectiveExpiry > 0 && effectiveExpiry <= Date.now()) {
    dbObj[id] = { ...(dbObj[id] as Record<string, unknown>), premium: false };
    await writeJson(JSON_FILE, dbObj);
    user.premium = false;
  }
  const normalizedAge = normalizeAgeValue(user.age);
  if (normalizedAge !== user.age) {
    dbObj[id] = { ...(dbObj[id] as Record<string, unknown>), age: normalizedAge };
    await writeJson(JSON_FILE, dbObj);
    return { ...user, age: normalizedAge };
  }
  return user;
}

export async function updateUser(id: number, data: Partial<User>): Promise<void> {
  const normalizedData: Partial<User> = {
    ...data,
    ...(Object.prototype.hasOwnProperty.call(data, "age") ? { age: normalizeAgeValue(data.age ?? null) } : {})
  };

  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      await collection.updateOne(
        { telegramId: id },
        { $set: { ...normalizedData, telegramId: id } },
        { upsert: true }
      );
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB updateUser error:", error);
      // Continue to JSON fallback for this operation
    }
  }
  
  // JSON fallback
  const dbObj = await readJson(JSON_FILE);
  dbObj[id] = { ...(dbObj[id] || {}), ...normalizedData };
  await writeJson(JSON_FILE, dbObj);
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

export async function getBlockedUsers(userId: number): Promise<number[]> {
  const user = await getUser(userId);
  return user.blockedUsers || [];
}

export async function blockUserForUser(userId: number, blockedUserId: number): Promise<{ success: boolean; message: string }> {
  if (userId === blockedUserId) {
    return { success: false, message: "You cannot block yourself." };
  }

  const user = await getUser(userId);
  const current = user.blockedUsers || [];

  if (current.includes(blockedUserId)) {
    return { success: true, message: "User is already blocked." };
  }

  await updateUser(userId, { blockedUsers: [...current, blockedUserId] });
  return { success: true, message: "User blocked successfully." };
}

export async function unblockUserForUser(userId: number, blockedUserId: number): Promise<boolean> {
  const user = await getUser(userId);
  const current = user.blockedUsers || [];
  if (!current.includes(blockedUserId)) {
    return false;
  }

  await updateUser(userId, { blockedUsers: current.filter(id => id !== blockedUserId) });
  return true;
}

export async function areUsersMutuallyBlocked(userId: number, otherUserId: number): Promise<boolean> {
  const [user, other] = await Promise.all([getUser(userId), getUser(otherUserId)]);
  const userBlocked = (user.blockedUsers || []).includes(otherUserId);
  const otherBlocked = (other.blockedUsers || []).includes(userId);
  return userBlocked || otherBlocked;
}

// ==================== BAN FUNCTIONS ====================

// Ban interface with metadata
export interface Ban {
  _id?: ObjectId;
  telegramId: number;
  reason: string;
  bannedAt: number;
  bannedBy: number;
  banExpiresAt?: number; // For temporary bans (timestamp when ban expires)
}

type JsonBanMeta = {
  reason?: string;
  bannedAt?: number;
  bannedBy?: number;
  banExpiresAt?: number;
};

type JsonBans = Record<string, JsonBanMeta> | number[];

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
  
  // JSON fallback - store as object with metadata (locked)
  let bans = await readJson<JsonBans>(BANS_FILE);

  // Convert array to object format if needed (migration)
  if (Array.isArray(bans)) {
    const oldBans = bans;
    bans = {};
    for (const bid of oldBans) {
      bans[bid] = { reason: "Migrated", bannedAt: Date.now(), bannedBy: 0 };
    }
  }

  bans[id] = {
    reason: reason,
    bannedAt: Date.now(),
    bannedBy: adminId
  };
  await writeJson(BANS_FILE, bans);
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
  
  // JSON fallback (locked)
  const bans = await readJson<JsonBans>(BANS_FILE);
  
  // Handle both array and object formats
  if (Array.isArray(bans)) {
    const index = bans.indexOf(id);
    if (index > -1) {
      bans.splice(index, 1);
    }
  } else if (bans[id]) {
    delete bans[id];
  }
  await writeJson(BANS_FILE, bans);
}

// Temporary ban function
export async function tempBanUser(id: number, durationMs: number, reason: string = "Temporarily banned", adminId: number = 0): Promise<void> {
  const banExpiresAt = Date.now() + durationMs;
  
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<Ban>("bans");
      
      await bansCollection.updateOne(
        { telegramId: id },
        { 
          $set: { 
            telegramId: id, 
            reason: reason,
            bannedAt: Date.now(),
            bannedBy: adminId,
            banExpiresAt: banExpiresAt
          } 
        },
        { upsert: true }
      );
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB tempBanUser error:", error);
    }
  }
  
  // JSON fallback
  let bans = await readJson<JsonBans>(BANS_FILE);
  
  if (Array.isArray(bans)) {
    const oldBans = bans;
    bans = {};
    for (const bid of oldBans) {
      bans[bid] = { reason: "Migrated", bannedAt: Date.now(), bannedBy: 0 };
    }
  }
  
  bans[id] = {
    reason: reason,
    bannedAt: Date.now(),
    bannedBy: adminId,
    banExpiresAt: banExpiresAt
  };
  await writeJson(BANS_FILE, bans);
}

// Check if a temporary ban has expired and auto-unban
export async function checkAndRemoveExpiredBan(id: number): Promise<boolean> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const database = await connectToDatabase();
      const bansCollection = database.collection<Ban>("bans");
      const ban = await bansCollection.findOne({ telegramId: id });
      
      if (ban && ban.banExpiresAt && ban.banExpiresAt < Date.now()) {
        // Ban has expired, remove it
        await bansCollection.deleteOne({ telegramId: id });
        return true; // Was expired and removed
      }
      return false;
    } catch (error) {
      console.error("[ERROR] - MongoDB checkAndRemoveExpiredBan error:", error);
      return false;
    }
  }
  
  // JSON fallback
  const bans = await readJson<JsonBans>(BANS_FILE);
  if (Array.isArray(bans)) {
    return false;
  }
  if (bans[id] && bans[id].banExpiresAt && bans[id].banExpiresAt < Date.now()) {
    delete bans[id];
    await writeJson(BANS_FILE, bans);
    return true;
  }
  return false;
}

// Get user's latest report reason
export async function getUserLatestReportReason(userId: number): Promise<string | null> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getReportsCollection();
      const latestReport = await collection
        .find({ reportedUser: userId })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      
      if (latestReport && latestReport.length > 0) {
        return latestReport[0].reason;
      }

      const usersCollection = await getUsersCollection();
      const user = await usersCollection.findOne({ telegramId: userId });
      return user?.reportReason || null;
    } catch (error) {
      console.error("[ERROR] - MongoDB getUserLatestReportReason error:", error);
    }
  }
  
  // JSON fallback - check user's report history
  const user = await getUser(userId);
  const history = ((user as User & { reportHistory?: Report[] }).reportHistory) || [];
  if (history.length > 0) {
    const latestReport = history[history.length - 1];
    return latestReport?.reason || null;
  }
  return user.reportReason || null;
}

export async function isBanned(id: number): Promise<boolean> {
  // First check and remove expired temporary bans
  await checkAndRemoveExpiredBan(id);
  
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
  const bans = await readJson<JsonBans>(BANS_FILE);
  
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
  
  // JSON fallback - with array->object migration support (locked)
  // Initialize with object format if doesn't exist
  const bans = await readJson<JsonBans>(BANS_FILE);

  // If file was just created, readJson already wrote '{}'
  if (!bans) {
    return [];
  }

  
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
    await writeJson(BANS_FILE, banObject);
    console.log(`[readBans] Migrated ${bans.length} bans to object format`);
    return Object.keys(banObject).map(key => parseInt(key, 10));
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
  
  // JSON fallback (locked)
  const dbObj = await readJson(JSON_FILE);
  return Object.keys(dbObj);

}

export async function getReportCount(id: number): Promise<number> {
  let count = 0;
  
  // First try MongoDB
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getReportsCollection();
      count = await collection.countDocuments({ reportedUser: id });
      if (count > 0) {
        return count;
      }

      const usersCollection = await getUsersCollection();
      const user = await usersCollection.findOne({ telegramId: id });
      if (user?.reports) {
        return user.reports;
      }
    } catch (error) {
      console.error("[ERROR] - MongoDB getReportCount error:", error);
    }
  }
  
  // Also check JSON fallback for reports (locked)
  try {
    const dbObj = await readJson<JsonUsersDb>(JSON_FILE);
    const userData = dbObj[id.toString()];
    
    if (userData) {
      // Prefer the structured history source when present; fallback to legacy count.
      if (userData.reportHistory && Array.isArray(userData.reportHistory)) {
        return count + userData.reportHistory.length;
      }
      return count + (userData.reports || 0);
    }
  } catch (error) {
    console.error("[ERROR] - Reading report count from JSON:", error);
  }
  
  return count;
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
): Promise<number> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getReportsCollection();
      await collection.insertOne({
        reportedUser: reportedUserId,
        reportedBy: reportedByUserId,
        reason: reason,
        createdAt: Date.now()
      });

      const usersCollection = await getUsersCollection();
      await usersCollection.updateOne(
        { telegramId: reportedUserId },
        {
          $set: {
            telegramId: reportedUserId,
            reportReason: reason,
            reportingPartner: reportedByUserId
          },
          $inc: { reports: 1 }
        },
        { upsert: true }
      );

      // Return authoritative count from reports collection.
      const totalReports = await collection.countDocuments({ reportedUser: reportedUserId });
      return totalReports;
    } catch (error) {
      console.error("[ERROR] - MongoDB createReport error:", error);
    }
  }
  
  // JSON/file fallback - update user fields for backward compatibility (locked)
  const dbObj = await readJson<JsonUsersDb>(JSON_FILE);
  
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
  
  // Keep only lightweight legacy pointers for admin views.
  dbObj[reportedUserId].reportReason = reason; // Keep for backward compatibility
  dbObj[reportedUserId].reportingPartner = reportedByUserId;
  
  await writeJson(JSON_FILE, dbObj);
  return dbObj[reportedUserId].reportHistory?.length || 0;
}

// Get all reports grouped by user (for admin view - scalable)
export async function getGroupedReports(limit: number = 10, offset: number = 0): Promise<{ userId: number; count: number; latestReason: string; reporters: number[] }[]> {
  let mongoResults: { userId: number; count: number; latestReason: string; reporters: number[] }[] = [];
  let mongoSummaryResults: { userId: number; count: number; latestReason: string; reporters: number[] }[] = [];
  
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
      mongoResults = results.map(r => ({
        userId: r.userId,
        count: r.count,
        latestReason: r.latestReason,
        reporters: r.reporters || []
      }));

      const usersCollection = await getUsersCollection();
      const userSummaries = await usersCollection.find({
        $or: [
          { reports: { $gt: 0 } },
          { reportReason: { $exists: true, $ne: null } }
        ]
      }).sort({ reports: -1 }).toArray();

      mongoSummaryResults = userSummaries.map(user => ({
        userId: user.telegramId,
        count: user.reports || 0,
        latestReason: user.reportReason || "No reason",
        reporters: user.reportingPartner ? [user.reportingPartner] : []
      }));
    } catch (error) {
      console.error("[ERROR] - MongoDB getGroupedReports error:", error);
    }
  }
  
  // Also check JSON fallback for reports (in case MongoDB is empty or not available)
  const jsonReports = await getReportsFromJson();
  
  // Merge MongoDB and JSON results, avoiding duplicates
  const mergedMap = new Map<number, { userId: number; count: number; latestReason: string; reporters: number[] }>();
  
  // Add MongoDB results first
  for (const r of mongoResults) {
    mergedMap.set(r.userId, r);
  }

  for (const r of mongoSummaryResults) {
    if (mergedMap.has(r.userId)) {
      const existing = mergedMap.get(r.userId)!;
      existing.count = Math.max(existing.count, r.count);
      if (!existing.latestReason && r.latestReason) {
        existing.latestReason = r.latestReason;
      }
      for (const reporter of r.reporters) {
        if (!existing.reporters.includes(reporter)) {
          existing.reporters.push(reporter);
        }
      }
    } else {
      mergedMap.set(r.userId, r);
    }
  }
  
  // Merge JSON results (add counts if user already exists)
  for (const r of jsonReports) {
    if (mergedMap.has(r.userId)) {
      // User exists in MongoDB; avoid double counting by taking the larger count.
      const existing = mergedMap.get(r.userId)!;
      existing.count = Math.max(existing.count, r.count);
      // Use JSON reason if MongoDB doesn't have one
      if (!existing.latestReason && r.latestReason) {
        existing.latestReason = r.latestReason;
      }
      // Merge reporters
      for (const reporter of r.reporters) {
        if (!existing.reporters.includes(reporter)) {
          existing.reporters.push(reporter);
        }
      }
    } else {
      // User only in JSON, add them
      mergedMap.set(r.userId, r);
    }
  }
  
  // Convert to array and sort
  const combinedResults = Array.from(mergedMap.values());
  combinedResults.sort((a, b) => b.count - a.count);

  return combinedResults.slice(offset, offset + limit);
}

export async function getGroupedReportsCount(): Promise<number> {
  const uniqueUserIds = new Set<number>();

  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getReportsCollection();
      const reportedUsers = await collection.distinct("reportedUser");
      for (const userId of reportedUsers) {
        uniqueUserIds.add(userId);
      }

      const usersCollection = await getUsersCollection();
      const userSummaries = await usersCollection.find({
        $or: [
          { reports: { $gt: 0 } },
          { reportReason: { $exists: true, $ne: null } }
        ]
      }).project({ telegramId: 1 }).toArray();

      for (const user of userSummaries) {
        uniqueUserIds.add(user.telegramId);
      }
    } catch (error) {
      console.error("[ERROR] - MongoDB getGroupedReportsCount error:", error);
    }
  }

  const jsonReports = await getReportsFromJson();
  for (const report of jsonReports) {
    uniqueUserIds.add(report.userId);
  }

  return uniqueUserIds.size;
}

// Helper function to get reports from JSON file
async function getReportsFromJson(): Promise<{ userId: number; count: number; latestReason: string; reporters: number[] }[]> {
  const userReports: { userId: number; count: number; latestReason: string; reporters: number[] }[] = [];
  
  try {
    const dbObj = await readJson<JsonUsersDb>(JSON_FILE);
    if (!dbObj) {
      return userReports;
    }

    for (const [idStr, userData] of Object.entries(dbObj)) {
      const userId = parseInt(idStr);
      const data = userData as JsonUserRecord;

      // Prefer reportHistory (new format); fallback to legacy reports fields.
      if (data.reportHistory && Array.isArray(data.reportHistory) && data.reportHistory.length > 0) {
        const reporters = data.reportHistory
          .map((r: LegacyReportEntry) => r.reportedBy)
          .filter((r: number) => !!r);
        const latestReport = data.reportHistory[data.reportHistory.length - 1];
        userReports.push({
          userId,
          count: data.reportHistory.length,
          latestReason: latestReport?.reason || "No reason",
          reporters
        });
      } else if (data.reports && data.reports > 0) {
        userReports.push({
          userId,
          count: data.reports || 0,
          latestReason: data.reportReason || "No reason",
          reporters: data.reportingPartner ? [data.reportingPartner] : []
        });
      }
    }
  } catch (error) {
    console.error("[ERROR] - Reading reports from JSON:", error);
  }
  
  return userReports;
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
  const history = ((user as User & { reportHistory?: LegacyReportEntry[] }).reportHistory) || [];
  return history.map((r: LegacyReportEntry) => ({
    reportedUser: userId,
    reportedBy: r.reportedBy,
    reason: r.reason,
    createdAt: r.createdAt
  }));
}

// Reset all report data for one user (scalable + legacy)
export async function resetUserReports(userId: number): Promise<void> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const reportsCollection = await getReportsCollection();
      await reportsCollection.deleteMany({ reportedUser: userId });

      const usersCollection = await getUsersCollection();
      await usersCollection.updateOne(
        { telegramId: userId },
        {
          $set: {
            reports: 0,
            reportCount: 0,
            reportingPartner: null,
            reportReason: null
          }
        }
      );
      return;
    } catch (error) {
      console.error("[ERROR] - MongoDB resetUserReports error:", error);
      // Continue to JSON fallback for resilience.
    }
  }

  const dbObj = await readJson<JsonUsersDb>(JSON_FILE);
  const key = userId.toString();
  if (!dbObj[key]) {
    dbObj[key] = {};
  }

  dbObj[key] = {
    ...(dbObj[key] || {}),
    reports: 0,
    reportCount: 0,
    reportHistory: [],
    reportingPartner: null,
    reportReason: null
  };

  await writeJson(JSON_FILE, dbObj);
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
  
  // JSON fallback - check object format (locked)
  const bans = await readJson<JsonBans>(BANS_FILE);
  
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
  
  // JSON fallback (locked)
  const dbObj = await readJson<JsonUsersDb>(JSON_FILE);
  if (dbObj[id]) {
    delete dbObj[id];
    await writeJson(JSON_FILE, dbObj);
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
  
  // JSON fallback - read from file (locked)
  const statsFile = "src/storage/stats.json";
  const stats = await readJson<JsonStats>(statsFile);
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
  
  // JSON fallback - update file (locked)
  const statsFile = "src/storage/stats.json";
  const stats = await readJson<JsonStats>(statsFile);
  stats.totalChats = (stats.totalChats || 0) + 1;
  await writeJson(statsFile, stats);
}

export async function migrateAgeRangesToExactAges(): Promise<number> {
  let updated = 0;

  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      for (const [range, normalized] of Object.entries(AGE_RANGE_TO_AVERAGE)) {
        const result = await collection.updateMany(
          { age: range },
          { $set: { age: normalized } }
        );
        updated += result.modifiedCount;
      }
    } catch (error) {
      console.error("[ERROR] - MongoDB migrateAgeRangesToExactAges error:", error);
    }

    return updated;
  }

  try {
    const dbObj = await readJson<JsonUsersDb>(JSON_FILE);
    let jsonUpdated = 0;

    for (const [id, userData] of Object.entries(dbObj)) {
      const normalizedAge = normalizeAgeValue(userData.age || null);
      if (normalizedAge !== (userData.age || null)) {
        dbObj[id] = { ...userData, age: normalizedAge };
        jsonUpdated++;
      }
    }

    if (jsonUpdated > 0) {
      await writeJson(JSON_FILE, dbObj);
    }

    updated += jsonUpdated;
  } catch (error) {
    console.error("[ERROR] - JSON migrateAgeRangesToExactAges error:", error);
  }

  return updated;
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
  
  // JSON fallback (locked)
  const dbObj = await readJson<JsonUsersDb>(JSON_FILE);
  if (!dbObj) return [];
  const inactiveIds: string[] = [];
  for (const [id, userData] of Object.entries(dbObj)) {
    const user = userData as JsonUserRecord;
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
  const now = Date.now();
  const oneDayAgo = now - (1 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      const total = await collection.countDocuments({});
      const activeToday = await collection.countDocuments({ lastActive: { $gte: oneDayAgo } });
      const inactive7Days = await collection.countDocuments({ lastActive: { $lt: sevenDaysAgo } });
      const inactive30Days = await collection.countDocuments({ lastActive: { $lt: thirtyDaysAgo } });
      return { total, activeToday, inactive7Days, inactive30Days };
    } catch (error) {
      console.error("[ERROR] - MongoDB getUserStats error:", error);
      // fall through to JSON fallback if query fails
    }
  }

  // JSON fallback - iterate manually
  const allUsers = await getAllUsers();
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
            
            // Count users who have been referred (have a referredBy value)
            const totalReferrals = await collection.countDocuments({ referredBy: { $exists: true, $ne: "" } });
            
            // Count users who have referred at least one person
            const usersWithReferrals = await collection.countDocuments({ referralCount: { $gt: 0 } });
            
            return {
                totalReferrals,
                usersWithReferrals
            };
        } catch (error) {
            console.error("[ERROR] - MongoDB getAllReferralStats error:", error);
        }
    }
    
    // JSON fallback - count users with referredBy set
    const allUsers = await getAllUsers();
    let totalReferrals = 0;
    let usersWithReferrals = 0;
    
    for (const id of allUsers) {
        const user = await getUser(parseInt(id));
        // Count users who were referred (have referredBy)
        if (user.referredBy) {
            totalReferrals++;
        }
        // Count users who have referred someone
        if ((user.referralCount || 0) > 0) {
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
  
  // JSON fallback (locked)
  const dbObj = await readJson<JsonUsersDb>(JSON_FILE);
  if (!dbObj) return null;
  for (const [id, userData] of Object.entries(dbObj)) {
    const user = userData as JsonUserRecord;
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
    const currentExpiry = referrer.premiumExpires || referrer.premiumExpiry || 0;
    const newExpiry = Math.max(currentExpiry, Date.now()) + (newPremiumDays * 24 * 60 * 60 * 1000);
    
    await updateUser(referrerId, {
      premium: true,
      premiumExpiry: newExpiry,
      premiumExpires: newExpiry,
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

// ==================== TELEGRAM STARS PREMIUM PAYMENTS ====================

function createStarsOrderId(): string {
  return `stars_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createPremiumPaymentOrder(
  userId: number,
  planId: string,
  premiumDays: number,
  starsAmount: number
): Promise<PremiumPaymentOrder> {
  const order: PremiumPaymentOrder = {
    orderId: createStarsOrderId(),
    userId,
    planId,
    premiumDays,
    starsAmount,
    currency: "XTR",
    status: "pending",
    entitlementApplied: false,
    createdAt: Date.now()
  };

  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getPremiumOrdersCollection();
      await collection.insertOne(order);
      return order;
    } catch (error) {
      console.error("[ERROR] - MongoDB createPremiumPaymentOrder error:", error);
    }
  }

  const orders = await readJson<JsonPaymentOrdersDb>(PAYMENT_ORDERS_FILE);
  orders[order.orderId] = order;
  await writeJson(PAYMENT_ORDERS_FILE, orders);
  return order;
}

export async function getPremiumPaymentOrder(orderId: string): Promise<PremiumPaymentOrder | null> {
  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getPremiumOrdersCollection();
      return await collection.findOne({ orderId });
    } catch (error) {
      console.error("[ERROR] - MongoDB getPremiumPaymentOrder error:", error);
    }
  }

  const orders = await readJson<JsonPaymentOrdersDb>(PAYMENT_ORDERS_FILE);
  return orders[orderId] || null;
}

export async function validatePremiumPaymentCheckout(
  orderId: string,
  userId: number,
  totalAmount: number,
  currency: string
): Promise<{ valid: boolean; message?: string }> {
  const order = await getPremiumPaymentOrder(orderId);
  if (!order) {
    return { valid: false, message: "Order not found" };
  }
  if (order.userId !== userId) {
    return { valid: false, message: "Order user mismatch" };
  }
  if (order.status !== "pending") {
    return { valid: false, message: "Order is not pending" };
  }
  if (order.currency !== "XTR" || currency !== "XTR") {
    return { valid: false, message: "Unsupported currency" };
  }
  if (order.starsAmount !== totalAmount) {
    return { valid: false, message: "Amount mismatch" };
  }
  return { valid: true };
}

export async function finalizePremiumPayment(
  orderId: string,
  telegramPaymentChargeId: string,
  providerPaymentChargeId: string | undefined
): Promise<{ success: boolean; alreadyProcessed: boolean; premiumUntil: number | null; message?: string }> {
  const order = await getPremiumPaymentOrder(orderId);
  if (!order) {
    return { success: false, alreadyProcessed: false, premiumUntil: null, message: "Order not found" };
  }

  if (order.status === "paid" && order.entitlementApplied) {
    const user = await getUser(order.userId);
    return { success: true, alreadyProcessed: true, premiumUntil: user.premiumExpires || user.premiumExpiry || null };
  }

  if (order.status !== "pending" && !(order.status === "paid" && !order.entitlementApplied)) {
    return { success: false, alreadyProcessed: false, premiumUntil: null, message: "Order not payable" };
  }

  if (order.status === "pending") {
    if (useMongoDB && !isFallbackMode) {
      try {
        const collection = await getPremiumOrdersCollection();
        const result = await collection.updateOne(
          { orderId, status: "pending" },
          {
            $set: {
              status: "paid",
              paidAt: Date.now(),
              telegramPaymentChargeId,
              providerPaymentChargeId: providerPaymentChargeId || "",
              entitlementApplied: false
            }
          }
        );
        if (result.modifiedCount === 0) {
          const latest = await collection.findOne({ orderId });
          if (!latest || (latest.status !== "paid" && latest.status !== "pending")) {
            return { success: false, alreadyProcessed: false, premiumUntil: null, message: "Unable to lock order" };
          }
        }
      } catch (error) {
        console.error("[ERROR] - MongoDB finalizePremiumPayment order update error:", error);
        return { success: false, alreadyProcessed: false, premiumUntil: null, message: "Order update failed" };
      }
    } else {
      const orders = await readJson<JsonPaymentOrdersDb>(PAYMENT_ORDERS_FILE);
      const current = orders[orderId];
      if (!current) {
        return { success: false, alreadyProcessed: false, premiumUntil: null, message: "Order not found" };
      }
      if (current.status !== "pending" && !(current.status === "paid" && !current.entitlementApplied)) {
        return { success: false, alreadyProcessed: false, premiumUntil: null, message: "Order not payable" };
      }
      orders[orderId] = {
        ...current,
        status: "paid",
        paidAt: Date.now(),
        telegramPaymentChargeId,
        providerPaymentChargeId: providerPaymentChargeId || "",
        entitlementApplied: current.entitlementApplied || false
      };
      await writeJson(PAYMENT_ORDERS_FILE, orders);
    }
  }

  const latestOrder = await getPremiumPaymentOrder(orderId);
  if (!latestOrder) {
    return { success: false, alreadyProcessed: false, premiumUntil: null, message: "Order missing after update" };
  }

  if (latestOrder.entitlementApplied) {
    const user = await getUser(latestOrder.userId);
    return { success: true, alreadyProcessed: true, premiumUntil: user.premiumExpires || user.premiumExpiry || null };
  }

  const user = await getUser(latestOrder.userId);
  const now = Date.now();
  const currentExpiry = user.premiumExpires || user.premiumExpiry || 0;
  const baseExpiry = user.premium && currentExpiry > now ? currentExpiry : now;
  const premiumUntil = baseExpiry + latestOrder.premiumDays * 24 * 60 * 60 * 1000;

  await updateUser(latestOrder.userId, {
    premium: true,
    premiumExpiry: premiumUntil,
    premiumExpires: premiumUntil
  });

  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getPremiumOrdersCollection();
      await collection.updateOne(
        { orderId },
        {
          $set: {
            entitlementApplied: true
          }
        }
      );
    } catch (error) {
      console.error("[ERROR] - MongoDB finalizePremiumPayment entitlement flag error:", error);
    }
  } else {
    const orders = await readJson<JsonPaymentOrdersDb>(PAYMENT_ORDERS_FILE);
    if (orders[orderId]) {
      orders[orderId] = {
        ...orders[orderId],
        entitlementApplied: true
      };
      await writeJson(PAYMENT_ORDERS_FILE, orders);
    }
  }

  return { success: true, alreadyProcessed: false, premiumUntil };
}

export async function revokeExpiredPremiumUsers(): Promise<number> {
  const now = Date.now();

  if (useMongoDB && !isFallbackMode) {
    try {
      const collection = await getUsersCollection();
      const result = await collection.updateMany(
        {
          premium: true,
          $or: [
            { premiumExpires: { $lte: now } },
            { premiumExpiry: { $lte: now } }
          ]
        },
        { $set: { premium: false } }
      );
      return result.modifiedCount;
    } catch (error) {
      console.error("[ERROR] - MongoDB revokeExpiredPremiumUsers error:", error);
    }
  }

  const users = await readJson<JsonUsersDb>(JSON_FILE);
  let updated = 0;

  for (const [id, data] of Object.entries(users)) {
    const expiry = data.premiumExpires || data.premiumExpiry || 0;
    if (data.premium && expiry > 0 && expiry <= now) {
      users[id] = {
        ...data,
        premium: false
      };
      updated++;
    }
  }

  if (updated > 0) {
    await writeJson(JSON_FILE, users);
  }

  return updated;
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

