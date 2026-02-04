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
// Report reasons with buttons
const reportReasons = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🎭 Impersonating", "REPORT_IMPERSONATING")],
    [telegraf_1.Markup.button.callback("🔞 Sexual content", "REPORT_SEXUAL")],
    [telegraf_1.Markup.button.callback("💰 Fraud", "REPORT_FRAUD")],
    [telegraf_1.Markup.button.callback("😠 Insulting", "REPORT_INSULTING")],
    [telegraf_1.Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);
const backKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔙 Back", "REPORT_CANCEL")]
]);
exports.default = {
    name: "report",
    description: "Report a user",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        if (!ctx.from)
            return;
        const user = yield (0, db_1.getUser)(ctx.from.id);
        let partnerId = null;
        let message = "Select a reason to report:";
        // If user is in a chat, report current partner
        if (bot.runningChats.includes(ctx.from.id)) {
            partnerId = bot.getPartner(ctx.from.id);
            message = `Report your current chat partner:\n\nSelect a reason:`;
        }
        // If user has a last partner stored, report them
        else if (user.lastPartner) {
            partnerId = user.lastPartner;
            message = `Report your last chat partner:\n\nSelect a reason:`;
        }
        else {
            return ctx.reply("You haven't chatted with anyone yet.");
        }
        // Store the partner ID for this report session
        yield (0, db_1.updateUser)(ctx.from.id, { reportingPartner: partnerId });
        return ctx.reply(message, reportReasons);
    })
};
