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
exports.closeDatabase = closeDatabase;
const mongodb_1 = require("mongodb");
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "anonymous_chatbot";
let client = null;
let db = null;
// Connect to MongoDB
function connectToDatabase() {
    return __awaiter(this, void 0, void 0, function* () {
        if (db)
            return db;
        try {
            client = new mongodb_1.MongoClient(MONGODB_URI);
            yield client.connect();
            db = client.db(DB_NAME);
            console.log("[INFO] - Connected to MongoDB");
            // Create indexes
            yield db.collection("users").createIndex({ telegramId: 1 }, { unique: true });
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
let useMongoDB = true;
let isFallbackMode = false;
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
                console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
                isFallbackMode = true;
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
                console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
                isFallbackMode = true;
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
                console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
                isFallbackMode = true;
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
                console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
                isFallbackMode = true;
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
                console.error("[ERROR] - MongoDB error, falling back to JSON:", error);
                isFallbackMode = true;
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
                isFallbackMode = true;
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
