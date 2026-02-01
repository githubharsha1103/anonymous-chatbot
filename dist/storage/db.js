"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBans = readBans;
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
exports.getAllUsers = getAllUsers;
exports.getReportCount = getReportCount;
exports.getBanReason = getBanReason;
exports.deleteUser = deleteUser;
const fs = __importStar(require("fs"));
const FILE = "src/storage/users.json";
const BANS_FILE = "src/storage/bans.json";
function read() {
    if (!fs.existsSync(FILE))
        fs.writeFileSync(FILE, "{}");
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
function write(data) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
function readBans() {
    if (!fs.existsSync(BANS_FILE))
        fs.writeFileSync(BANS_FILE, "[]");
    return JSON.parse(fs.readFileSync(BANS_FILE, "utf8"));
}
function writeBans(data) {
    fs.writeFileSync(BANS_FILE, JSON.stringify(data, null, 2));
}
function getUser(id) {
    const db = read();
    if (!db[id]) {
        db[id] = {
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
        write(db);
        return Object.assign(Object.assign({}, db[id]), { isNew: true });
    }
    return db[id];
}
function updateUser(id, data) {
    const db = read();
    db[id] = Object.assign(Object.assign({}, getUser(id)), data);
    write(db);
}
function incDaily(id) {
    const db = read();
    db[id].daily++;
    write(db);
}
function setGender(id, gender) {
    updateUser(id, { gender });
}
function getGender(id) {
    return getUser(id).gender;
}
function setState(id, state) {
    updateUser(id, { state });
}
function getState(id) {
    return getUser(id).state;
}
function setAge(id, age) {
    updateUser(id, { age });
}
function getAge(id) {
    return getUser(id).age;
}
function banUser(id) {
    const bans = readBans();
    if (!bans.includes(id)) {
        bans.push(id);
        writeBans(bans);
    }
}
function unbanUser(id) {
    const bans = readBans();
    const index = bans.indexOf(id);
    if (index > -1) {
        bans.splice(index, 1);
        writeBans(bans);
    }
}
function isBanned(id) {
    const bans = readBans();
    return bans.includes(id);
}
function getAllUsers() {
    const db = read();
    return Object.keys(db);
}
function getReportCount(id) {
    const user = getUser(id);
    return user.reportCount || 0;
}
function getBanReason(id) {
    const user = getUser(id);
    return user.banReason || null;
}
function deleteUser(id) {
    const db = read();
    if (db[id]) {
        delete db[id];
        write(db);
        return true;
    }
    return false;
}
