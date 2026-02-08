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
const markup_1 = require("telegraf/markup");
exports.default = {
    name: "help",
    description: "See the available commands",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        yield ctx.reply("📚 <b>Available Commands:</b>\n\n" +
            "/start - Start the bot\n" +
            "/search - Find a chat partner\n" +
            "/next - Skip current chat and find new partner\n" +
            "/end - End the current chat\n" +
            "/settings - Open settings menu\n" +
            "/report - Report a user\n" +
            "/referral - Invite friends & earn premium\n" +
            "/help - Show this help message", Object.assign({ parse_mode: "HTML" }, (0, markup_1.removeKeyboard)()));
    })
};
