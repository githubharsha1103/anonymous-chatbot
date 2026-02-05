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
exports.mainMenuKeyboard = void 0;
const telegraf_1 = require("telegraf");
const db_1 = require("../storage/db");
// Profile setup keyboards with improved UX
// Step 1: Gender selection with back button
const genderKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [telegraf_1.Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")],
    [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_START")]
]);
// Step 2: Age range selection (easier than typing exact age)
const ageRangeKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [telegraf_1.Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [telegraf_1.Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [telegraf_1.Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_GENDER")]
]);
// Step 3: Country selection
const countryKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🇮🇳 India", "SETUP_COUNTRY_INDIA")],
    [telegraf_1.Markup.button.callback("🌍 Other", "SETUP_COUNTRY_OTHER")],
    [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);
// Step 3b: Indian states (if India selected)
const stateKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
    [telegraf_1.Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")],
    [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_COUNTRY")]
]);
// Skip state button (for non-Indian users)
const skipStateKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("Skip", "SETUP_SKIP_STATE")],
    [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_COUNTRY")]
]);
// Main menu keyboard
const mainMenuKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔍 Search", "START_SEARCH")],
    [telegraf_1.Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [telegraf_1.Markup.button.callback("❓ Help", "START_HELP")]
]);
exports.mainMenuKeyboard = mainMenuKeyboard;
exports.default = {
    name: "start",
    description: "Start the bot",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        // Save user's username if available
        const username = ((_b = ctx.from) === null || _b === void 0 ? void 0 : _b.username) || ((_c = ctx.from) === null || _c === void 0 ? void 0 : _c.first_name) || "Unknown";
        // Update user activity
        yield (0, db_1.updateLastActive)(userId);
        // Check if user is new and increment user count
        const user = yield (0, db_1.getUser)(userId);
        if (user.isNew) {
            // Set createdAt and lastActive for new users
            yield (0, db_1.updateUser)(userId, { createdAt: Date.now(), lastActive: Date.now() });
            bot.incrementUserCount();
            // New user - show improved profile setup
            yield ctx.reply("🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
                "Let's set up your profile to help you find great chat partners!\n\n" +
                "📝 *Step 1 of 3*\n" +
                "👤 *Select your gender:*", Object.assign({ parse_mode: "Markdown" }, genderKeyboard));
            return;
        }
        // Update lastActive for returning users
        yield (0, db_1.updateLastActive)(userId);
        // Existing user - show main menu
        yield ctx.reply("🌟 *Welcome back!* 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "Use the menu below to navigate:", Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
    })
};
