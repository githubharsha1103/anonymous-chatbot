"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUser = getUser;
exports.updateUser = updateUser;
exports.incDaily = incDaily;
exports.setGender = setGender;
exports.getGender = getGender;
exports.setState = setState;
exports.getState = getState;
exports.setAge = setAge;
exports.getAge = getAge;
exports.banUser = banUser;
exports.unbanUser = unbanUser;
exports.isBanned = isBanned;
exports.readBans = readBans;
exports.getAllUsers = getAllUsers;
exports.getReportCount = getReportCount;
exports.getBanReason = getBanReason;
exports.deleteUser = deleteUser;
exports.getTotalChats = getTotalChats;
exports.incrementTotalChats = incrementTotalChats;
exports.incUserTotalChats = incUserTotalChats;
exports.updateLastActive = updateLastActive;
exports.getInactiveUsers = getInactiveUsers;
exports.getUserStats = getUserStats;
exports.getReferralStats = getReferralStats;
exports.getReferralCount = getReferralCount;
exports.incrementReferralCount = incrementReferralCount;
exports.getUserByReferralCode = getUserByReferralCode;
exports.processReferral = processReferral;
exports.atomicIncrementReferralCount = atomicIncrementReferralCount;
exports.verifyReferralCounts = verifyReferralCounts;
exports.fixReferralCounts = fixReferralCounts;
exports.closeDatabase = closeDatabase;
const mongodb_1 = require("mongodb");
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
    w: "majority"
};
let client = null;
let db = null;
// Connect to MongoDB
function connectToDatabase() {
    return __awaiter(this, void 0, void 0, function* () {
        if (db)
            return db;
        try {
            client = new mongodb_1.MongoClient(MONGODB_URI, MONGO_OPTIONS);
            yield client.connect();
            db = client.db(DB_NAME);
            console.log("[INFO] - Connected to MongoDB");
            // Create indexes
            yield db.collection("users").createIndex({ telegramId: 1 }, { unique: true });
            yield db.collection("users").createIndex({ referralCode: 1 });
            yield db.collection("users").createIndex({ referredBy: 1 });
            return db;
        }
        catch (error) {
            console.error("[ERROR] - MongoDB connection failed:", error);
            throw error;
        }
    });
}
function getUsersCollection() {
    return __awaiter(this, void 0, void 0, function* () {
        const database = yield connectToDatabase();
        return database.collection("users");
    });
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
}
else if (!useMongoDB) {
    console.log("[INFO] - No MongoDB URI found, using JSON file storage");
}
else {
    console.log("[INFO] - MongoDB connection failed, using JSON file storage");
}
// ==================== USER FUNCTIONS ====================
function getUser(id) {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const collection = yield getUsersCollection();
                const user = yield collection.findOne({ telegramId: id });
                if (user)
                    return user;
                // Create new user
                const newUser = {
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
                yield collection.insertOne(newUser);
                return Object.assign(Object.assign({}, newUser), { isNew: true });
            }
            catch (error) {
                console.error("[ERROR] - MongoDB getUser error:", error);
                // Don't permanently switch to fallback - MongoDB might recover
                // Continue to try JSON fallback for this operation only
            }
        }
        // JSON fallback
        const fs = require("fs");
        if (!fs.existsSync(JSON_FILE))
            fs.writeFileSync(JSON_FILE, "{}");
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
            return Object.assign(Object.assign({}, dbObj[id]), { isNew: true });
        }
        return dbObj[id];
    });
}
function updateUser(id, data) {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const collection = yield getUsersCollection();
                yield collection.updateOne({ telegramId: id }, { $set: Object.assign(Object.assign({}, data), { telegramId: id }) }, { upsert: true });
                return;
            }
            catch (error) {
                console.error("[ERROR] - MongoDB updateUser error:", error);
                // Continue to JSON fallback for this operation
            }
        }
        // JSON fallback
        const fs = require("fs");
        const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
        dbObj[id] = Object.assign(Object.assign({}, (dbObj[id] || {})), data);
        fs.writeFileSync(JSON_FILE, JSON.stringify(dbObj, null, 2));
    });
}
function incDaily(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(id);
        yield updateUser(id, { daily: (user.daily || 0) + 1 });
    });
}
function setGender(id, gender) {
    return __awaiter(this, void 0, void 0, function* () {
        yield updateUser(id, { gender });
    });
}
function getGender(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(id);
        return user.gender;
    });
}
function setState(id, state) {
    return __awaiter(this, void 0, void 0, function* () {
        yield updateUser(id, { state });
    });
}
function getState(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(id);
        return user.state;
    });
}
function setAge(id, age) {
    return __awaiter(this, void 0, void 0, function* () {
        yield updateUser(id, { age });
    });
}
function getAge(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(id);
        return user.age;
    });
}
// ==================== BAN FUNCTIONS ====================
function banUser(id) {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const database = yield connectToDatabase();
                const bansCollection = database.collection("bans");
                yield bansCollection.insertOne({ telegramId: id });
                return;
            }
            catch (error) {
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
    });
}
function unbanUser(id) {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const database = yield connectToDatabase();
                const bansCollection = database.collection("bans");
                yield bansCollection.deleteOne({ telegramId: id });
                return;
            }
            catch (error) {
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
    });
}
function isBanned(id) {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const database = yield connectToDatabase();
                const bansCollection = database.collection("bans");
                const ban = yield bansCollection.findOne({ telegramId: id });
                return !!ban;
            }
            catch (error) {
                console.error("[ERROR] - MongoDB error:", error);
                // Don't switch to fallback permanently
            }
        }
        // JSON fallback
        const fs = require("fs");
        const bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
        return bans.includes(id);
    });
}
function readBans() {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const database = yield connectToDatabase();
                const bansCollection = database.collection("bans");
                const bans = yield bansCollection.find({}).toArray();
                return bans.map((b) => b.telegramId);
            }
            catch (error) {
                console.error("[ERROR] - MongoDB error:", error);
                // Don't switch to fallback permanently
            }
        }
        // JSON fallback
        const fs = require("fs");
        if (!fs.existsSync(BANS_FILE))
            fs.writeFileSync(BANS_FILE, "[]");
        return JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
    });
}
// ==================== USER MANAGEMENT ====================
function getAllUsers() {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const collection = yield getUsersCollection();
                const users = yield collection.find({}).toArray();
                return users.map((u) => u.telegramId.toString());
            }
            catch (error) {
                console.error("[ERROR] - MongoDB error:", error);
                // Don't switch to fallback permanently
            }
        }
        // JSON fallback
        const fs = require("fs");
        if (!fs.existsSync(JSON_FILE))
            fs.writeFileSync(JSON_FILE, "{}");
        const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
        return Object.keys(dbObj);
    });
}
function getReportCount(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(id);
        return user.reportCount || 0;
    });
}
function getBanReason(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(id);
        return user.banReason || null;
    });
}
function deleteUser(id, reason) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`[DELETE_USER] - User ${id} deleted. Reason: ${reason || 'unknown'}`);
        if (useMongoDB && !isFallbackMode) {
            try {
                const collection = yield getUsersCollection();
                const result = yield collection.deleteOne({ telegramId: id });
                return result.deletedCount > 0;
            }
            catch (error) {
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
    });
}
// Get global chat count
function getTotalChats() {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const database = yield connectToDatabase();
                const statsCollection = database.collection("stats");
                const stats = yield statsCollection.findOne({});
                return (stats === null || stats === void 0 ? void 0 : stats.totalChats) || 0;
            }
            catch (error) {
                console.error("[ERROR] - MongoDB error getting stats:", error);
                // Don't switch to fallback permanently
            }
        }
        // JSON fallback - read from file
        const fs = require("fs");
        const statsFile = "src/storage/stats.json";
        if (!fs.existsSync(statsFile))
            return 0;
        const stats = JSON.parse(fs.readFileSync(statsFile, "utf8"));
        return stats.totalChats || 0;
    });
}
// Increment global chat count
function incrementTotalChats() {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const database = yield connectToDatabase();
                const statsCollection = database.collection("stats");
                yield statsCollection.updateOne({}, { $inc: { totalChats: 1 }, $set: { lastUpdated: new Date() } }, { upsert: true });
                return;
            }
            catch (error) {
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
    });
}
// Increment user's total chats count
function incUserTotalChats(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(id);
        const currentTotal = user.totalChats || 0;
        yield updateUser(id, { totalChats: currentTotal + 1 });
    });
}
// ==================== RE-ENGAGEMENT FUNCTIONS ====================
// Update user's last active timestamp
function updateLastActive(id) {
    return __awaiter(this, void 0, void 0, function* () {
        yield updateUser(id, { lastActive: Date.now() });
    });
}
// Get users who haven't been active for X days
function getInactiveUsers(daysInactive) {
    return __awaiter(this, void 0, void 0, function* () {
        const cutoffTime = Date.now() - (daysInactive * 24 * 60 * 60 * 1000);
        if (useMongoDB && !isFallbackMode) {
            try {
                const collection = yield getUsersCollection();
                // Find users who haven't been active since the cutoff time
                // Also include users who never had lastActive set (created before cutoff but no activity)
                const users = yield collection.find({
                    $or: [
                        { lastActive: { $lt: cutoffTime } },
                        { lastActive: { $exists: false }, createdAt: { $lt: cutoffTime } }
                    ]
                }).toArray();
                return users.map((u) => u.telegramId.toString());
            }
            catch (error) {
                console.error("[ERROR] - MongoDB error getting inactive users:", error);
                // Don't switch to fallback permanently
            }
        }
        // JSON fallback
        const fs = require("fs");
        if (!fs.existsSync(JSON_FILE))
            return [];
        const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
        const inactiveIds = [];
        for (const [id, userData] of Object.entries(dbObj)) {
            const user = userData;
            const lastActive = user.lastActive || user.createdAt || 0;
            if (lastActive < cutoffTime) {
                inactiveIds.push(id);
            }
        }
        return inactiveIds;
    });
}
// Get user count by inactivity status
function getUserStats() {
    return __awaiter(this, void 0, void 0, function* () {
        const allUsers = yield getAllUsers();
        const now = Date.now();
        const oneDayAgo = now - (1 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        let activeToday = 0;
        let inactive7Days = 0;
        let inactive30Days = 0;
        for (const id of allUsers) {
            const userId = parseInt(id);
            const user = yield getUser(userId);
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
    });
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
function calculatePremiumDays(referralCount) {
    let totalDays = 0;
    let previousCount = 0;
    for (const tier of REFERRAL_TIERS) {
        if (referralCount >= tier.count) {
            // Calculate incremental days for this tier
            const incrementalCount = tier.count - previousCount;
            // Simplified: each tier gives its full premium days when reached
            totalDays = tier.premiumDays;
            previousCount = tier.count;
        }
        else if (referralCount > previousCount) {
            // Partially completed tier - no partial rewards in this model
            break;
        }
    }
    return totalDays;
}
function getReferralStats(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(userId);
        const referralCount = user.referralCount || 0;
        // Count active referrals (users who have been active in last 7 days)
        const allUsers = yield getAllUsers();
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        let activeCount = 0;
        for (const id of allUsers) {
            const referredUser = yield getUser(parseInt(id));
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
    });
}
// Get user's referral count
function getReferralCount(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield getUser(userId);
        return user.referralCount || 0;
    });
}
// Increment user's referral count and return new count
function incrementReferralCount(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const currentCount = yield getReferralCount(userId);
        const newCount = currentCount + 1;
        yield updateUser(userId, { referralCount: newCount });
        return newCount;
    });
}
// Find user by their referral code
function getUserByReferralCode(referralCode) {
    return __awaiter(this, void 0, void 0, function* () {
        if (useMongoDB && !isFallbackMode) {
            try {
                const collection = yield getUsersCollection();
                const user = yield collection.findOne({ referralCode });
                return user ? user.telegramId : null;
            }
            catch (error) {
                console.error("[ERROR] - MongoDB getUserByReferralCode error:", error);
            }
        }
        // JSON fallback
        const fs = require("fs");
        if (!fs.existsSync(JSON_FILE))
            return null;
        const dbObj = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
        for (const [id, userData] of Object.entries(dbObj)) {
            const user = userData;
            if (user.referralCode === referralCode) {
                return parseInt(id);
            }
        }
        return null;
    });
}
// Process a referral - call when a new user joins with a referral code
function processReferral(referredUserId, referralCode) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`[REFERRAL] - processReferral called: referredUserId=${referredUserId}, referralCode=${referralCode}`);
        // Find the referrer
        const referrerId = yield getUserByReferralCode(referralCode);
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
        const referredUser = yield getUser(referredUserId);
        console.log(`[REFERRAL] - referredUser.referredBy: ${referredUser.referredBy}`);
        if (referredUser.referredBy) {
            console.log(`[REFERRAL] - User ${referredUserId} was already referred by ${referredUser.referredBy}`);
            return false;
        }
        // Mark the referred user as having been referred
        yield updateUser(referredUserId, { referredBy: referralCode });
        console.log(`[REFERRAL] - Marked user ${referredUserId} as referred by ${referralCode}`);
        // Get referrer's current state before increment
        const referrer = yield getUser(referrerId);
        const oldCount = referrer.referralCount || 0;
        const claimedTiers = referrer.referralTiersClaimed || [];
        console.log(`[REFERRAL] - Referrer ${referrerId} current count: ${oldCount}`);
        // Increment referrer's count using atomic update
        console.log(`[REFERRAL] - About to increment referral count for referrer ${referrerId}`);
        yield atomicIncrementReferralCount(referrerId);
        // Verify and get new count
        const newCount = yield getReferralCount(referrerId);
        console.log(`[REFERRAL] - Referral count for user ${referrerId} is now: ${newCount}`);
        // Check for newly reached tiers and award premium
        let newPremiumDays = 0;
        const newlyClaimedTiers = [];
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
            yield updateUser(referrerId, {
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
    });
}
// Atomically increment referral count to prevent race conditions
function atomicIncrementReferralCount(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`[REFERRAL] - atomicIncrementReferralCount called for user ${userId}, useMongoDB=${useMongoDB}, isFallbackMode=${isFallbackMode}`);
        if (useMongoDB && !isFallbackMode) {
            try {
                const collection = yield getUsersCollection();
                const result = yield collection.updateOne({ telegramId: userId }, { $inc: { referralCount: 1 } });
                console.log(`[REFERRAL] - MongoDB update result: ${result.modifiedCount} documents modified`);
                return;
            }
            catch (error) {
                console.error("[ERROR] - MongoDB atomicIncrementReferralCount error:", error);
            }
        }
        // JSON fallback - use regular increment
        console.log(`[REFERRAL] - Using JSON fallback for incrementReferralCount`);
        yield incrementReferralCount(userId);
    });
}
// Debug function to verify referral counts
function verifyReferralCounts() {
    return __awaiter(this, void 0, void 0, function* () {
        const allUsers = yield getAllUsers();
        const discrepancies = [];
        for (const id of allUsers) {
            const userId = parseInt(id);
            const user = yield getUser(userId);
            const storedCount = user.referralCount || 0;
            // Count actual referrals
            let actualCount = 0;
            for (const otherId of allUsers) {
                const otherUser = yield getUser(parseInt(otherId));
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
    });
}
// Fix any referral count discrepancies
function fixReferralCounts() {
    return __awaiter(this, void 0, void 0, function* () {
        const { discrepancies } = yield verifyReferralCounts();
        let fixed = 0;
        for (const disc of discrepancies) {
            yield updateUser(disc.userId, { referralCount: disc.actual });
            console.log(`[REFERRAL] - Fixed referral count for user ${disc.userId}: ${disc.stored} -> ${disc.actual}`);
            fixed++;
        }
        return fixed;
    });
}
// Close MongoDB connection on process exit
function closeDatabase() {
    return __awaiter(this, void 0, void 0, function* () {
        if (client) {
            yield client.close();
            client = null;
            db = null;
            console.log("[INFO] - MongoDB connection closed");
        }
    });
}
