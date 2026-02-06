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
exports.genderKeyboard = exports.cancelKeyboard = exports.mainMenuKeyboard = exports.SETUP_STEP_DONE = exports.SETUP_STEP_STATE = exports.SETUP_STEP_AGE = exports.SETUP_STEP_GENDER = void 0;
const telegraf_1 = require("telegraf");
const db_1 = require("../storage/db");
// Setup step constants
exports.SETUP_STEP_GENDER = "gender";
exports.SETUP_STEP_AGE = "age";
exports.SETUP_STEP_STATE = "state";
exports.SETUP_STEP_DONE = "done";
// Welcome keyboard with animated welcome
const welcomeKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🌟 Get Started", "SETUP_GENDER_MALE")]
]);
// Gender selection with back button
const genderKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [telegraf_1.Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")],
    [telegraf_1.Markup.button.callback("⬅️ Back", "WELCOME_BACK")]
]);
exports.genderKeyboard = genderKeyboard;
// Cancel button for input steps
const cancelKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
]);
exports.cancelKeyboard = cancelKeyboard;
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
        var _a, _b, _c, _d, _e, _f;
        const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        // Save user's username if available
        const username = ((_b = ctx.from) === null || _b === void 0 ? void 0 : _b.username) || ((_c = ctx.from) === null || _c === void 0 ? void 0 : _c.first_name) || "Unknown";
        // Update user activity
        yield (0, db_1.updateLastActive)(userId);
        // Check if user is new and increment user count
        const user = yield (0, db_1.getUser)(userId);
        // Check for referral code in start parameter
        const startParam = ctx.startPayload || ((_f = (_e = (_d = ctx.update) === null || _d === void 0 ? void 0 : _d.message) === null || _e === void 0 ? void 0 : _e.text) === null || _f === void 0 ? void 0 : _f.split(" ")[1]);
        // Initialize new user
        if (user.isNew) {
            // Build update data
            const updateData = {
                createdAt: Date.now(),
                lastActive: Date.now(),
                name: username
            };
            // Set referredBy if referral code provided
            if (startParam && startParam.startsWith("REF")) {
                updateData.referredBy = startParam;
            }
            yield (0, db_1.updateUser)(userId, updateData);
            bot.incrementUserCount();
            // Process referral after user is created
            if (startParam && startParam.startsWith("REF")) {
                yield (0, db_1.processReferral)(userId, startParam);
                console.log(`[START] - User ${userId} started with referral code: ${startParam}`);
            }
            // New user - show animated welcome with Get Started button
            yield ctx.reply("🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
                "✨ Connect with strangers anonymously\n" +
                "🔒 Your privacy is protected\n" +
                "💬 Chat freely and safely\n\n" +
                "Tap *Get Started* to begin!", Object.assign({ parse_mode: "Markdown" }, welcomeKeyboard));
            return;
        }
        // Update lastActive for returning users
        yield (0, db_1.updateLastActive)(userId);
        // Check if user is in the middle of setup
        const setupStep = user.setupStep;
        if (setupStep === exports.SETUP_STEP_AGE) {
            // User needs to enter age - show age range buttons
            const ageKeyboard = telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback("13-17", "SETUP_AGE_13_17")],
                [telegraf_1.Markup.button.callback("18-25", "SETUP_AGE_18_25")],
                [telegraf_1.Markup.button.callback("26-40", "SETUP_AGE_26_40")],
                [telegraf_1.Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
                [telegraf_1.Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")],
                [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_GENDER")]
            ]);
            yield ctx.reply("📝 *Step 2 of 3*\n\n" +
                "🎂 *Select your age range:*\n" +
                "(This helps us match you with people in similar age groups)", Object.assign({ parse_mode: "Markdown" }, ageKeyboard));
            return;
        }
        if (setupStep === exports.SETUP_STEP_STATE) {
            // User needs to select state
            const stateKeyboard = telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
                [telegraf_1.Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
                [telegraf_1.Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
                [telegraf_1.Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")],
                [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
            ]);
            yield ctx.reply("📝 *Step 3 of 3*\n\n" +
                "📍 *Select your location:*\n" +
                "(Helps match you with nearby people)", Object.assign({ parse_mode: "Markdown" }, stateKeyboard));
            return;
        }
        // Existing user with complete profile - show main menu
        yield ctx.reply("🌟 *Welcome back!* 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "Use the menu below to navigate:", Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
    })
};
