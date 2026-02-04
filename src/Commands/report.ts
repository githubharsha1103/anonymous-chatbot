import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { Command } from "../Utils/commandHandler";
import { Markup } from "telegraf";
import { getUser, updateUser } from "../storage/db";

// Report reasons with buttons
const reportReasons = Markup.inlineKeyboard([
    [Markup.button.callback("🎭 Impersonating", "REPORT_IMPERSONATING")],
    [Markup.button.callback("🔞 Sexual content", "REPORT_SEXUAL")],
    [Markup.button.callback("💰 Fraud", "REPORT_FRAUD")],
    [Markup.button.callback("😠 Insulting", "REPORT_INSULTING")],
    [Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back", "REPORT_CANCEL")]
]);

export default {
    name: "report",
    description: "Report a user",
    execute: async (ctx: Context, bot: ExtraTelegraf) => {
        if (!ctx.from) return;

        const user = await getUser(ctx.from.id);
        let partnerId: number | null = null;
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
        await updateUser(ctx.from.id, { reportingPartner: partnerId });

        return ctx.reply(message, reportReasons);
    }
} as Command;
