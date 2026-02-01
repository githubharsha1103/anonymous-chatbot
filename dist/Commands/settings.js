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
exports.statePrompt = exports.agePrompt = exports.stateKeyboard = exports.genderKeyboard = void 0;
const telegraf_1 = require("telegraf");
const db_1 = require("../storage/db");
exports.default = {
    name: "settings",
    description: "Open settings menu",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!ctx.from)
            return;
        const u = (0, db_1.getUser)(ctx.from.id);
        const text = `⚙ Settings

👤 Gender: ${(_a = u.gender) !== null && _a !== void 0 ? _a : "Not Set"}
🎂 Age: ${(_b = u.age) !== null && _b !== void 0 ? _b : "Not Set"}
📍 State: ${(_c = u.state) !== null && _c !== void 0 ? _c : "Not Set"}
💕 Preference: ${u.preference === "any" ? "Any" : u.preference === "male" ? "Male" : "Female"}
💎 Premium: ${u.premium ? "Yes" : "No ❌"}
💬 Daily chats left: ${100 - (u.daily || 0)}/100

Use buttons below to update:`;
        return ctx.reply(text, telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("👤 Gender", "SET_GENDER")],
            [telegraf_1.Markup.button.callback("🎂 Age", "SET_AGE")],
            [telegraf_1.Markup.button.callback("📍 State", "SET_STATE")],
            [telegraf_1.Markup.button.callback("💕 Preference", "SET_PREFERENCE")]
        ]));
    })
};
// Gender selection keyboard
exports.genderKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👨 Male", "GENDER_MALE")],
    [telegraf_1.Markup.button.callback("👩 Female", "GENDER_FEMALE")],
    [telegraf_1.Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
// State selection keyboard
exports.stateKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("Telangana", "STATE_TELANGANA")],
    [telegraf_1.Markup.button.callback("Andhra Pradesh", "STATE_AP")],
    [telegraf_1.Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
// Age input prompt
exports.agePrompt = "Please enter your age (13-80):";
// State input prompt  
exports.statePrompt = "Select your state:";
