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
const telegraf_1 = require("telegraf");
const db_1 = require("../storage/db");
// Profile setup keyboards
const genderKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [telegraf_1.Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);
const ageInputKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
]);
const stateKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
    [telegraf_1.Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")]
]);
exports.default = {
    name: "start",
    description: "Start the bot",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        // Save user's username if available
        const username = ((_b = ctx.from) === null || _b === void 0 ? void 0 : _b.username) || ((_c = ctx.from) === null || _c === void 0 ? void 0 : _c.first_name) || "Unknown";
        yield (0, db_1.updateUser)(userId, { name: username });
        // Check if user is new and increment user count
        const user = yield (0, db_1.getUser)(userId);
        if (user.isNew) {
            bot.incrementUserCount();
            // New user - show profile setup (Gender → Age → State)
            yield ctx.reply("🌟 Welcome to Anonymous Chat! 🌟\n\nLet's set up your profile to get started.\n\n📝 *Step 1/3:* Please select your gender:", Object.assign({ parse_mode: "Markdown" }, genderKeyboard));
            return;
        }
        // Existing user - show main menu
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("🔍 Search", "START_SEARCH")],
            [telegraf_1.Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
            [telegraf_1.Markup.button.callback("❓ Help", "START_HELP")]
        ]);
        yield ctx.reply("🌟 Welcome back!\n\nThis bot helps you chat anonymously with people worldwide.\n\nUse the menu below to navigate:", keyboard);
    })
};
