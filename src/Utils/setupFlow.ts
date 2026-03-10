import { Markup } from "telegraf";
import type { User } from "../storage/db";

export type SetupStep = "gender" | "age" | "age_manual" | "state" | "state_other" | "done";

export const setupGenderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

export const setupAgeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);

export const setupStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
    [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);

export const setupAgeManualKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);

export const setupStateManualKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE")]
]);

export function getSetupStepPrompt(step: SetupStep): { text: string; keyboard?: ReturnType<typeof Markup.inlineKeyboard> } | null {
    switch (step) {
        case "gender":
            return {
                text:
                    "📝 *Step 1 of 3*\n\n" +
                    "👤 *Select your gender:*",
                keyboard: setupGenderKeyboard
            };
        case "age":
            return {
                text:
                    "📝 *Step 2 of 3*\n\n" +
                    "🎂 *Select your age range:*\n" +
                    "(This helps us match you with people in similar age groups)",
                keyboard: setupAgeKeyboard
            };
        case "age_manual":
            return {
                text:
                    "📝 *Enter your age:*\n\n" +
                    "Please type a number between 13 and 80\n" +
                    "(e.g., 21)",
                keyboard: setupAgeManualKeyboard
            };
        case "state":
            return {
                text:
                    "📝 *Step 3 of 3*\n\n" +
                    "📍 *Select your location:*\n" +
                    "(Helps match you with nearby people)",
                keyboard: setupStateKeyboard
            };
        case "state_other":
            return {
                text:
                    "📍 *Enter your state:*\n\n" +
                    "(e.g., Karnataka, Tamil Nadu, Maharashtra, etc.)",
                keyboard: setupStateManualKeyboard
            };
        default:
            return null;
    }
}

export function getSetupRequiredPrompt(user: Pick<User, "gender" | "age" | "state">): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } | null {
    if (!user.gender) {
        return {
            text:
                "📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before using the bot.\n\n" +
                "👤 *Step 1 of 3*\n" +
                "Select your gender:",
            keyboard: setupGenderKeyboard
        };
    }

    if (!user.age) {
        return {
            text:
                "📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before using the bot.\n\n" +
                "👤 *Step 2 of 3*\n" +
                "🎂 *Select your age range:*\n" +
                "(This helps us match you with people in similar age groups)",
            keyboard: setupAgeKeyboard
        };
    }

    if (!user.state) {
        return {
            text:
                "📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before using the bot.\n\n" +
                "👤 *Step 3 of 3*\n" +
                "📍 *Select your location:*\n" +
                "(Helps match you with nearby people)",
            keyboard: setupStateKeyboard
        };
    }

    return null;
}

export function getSetupCompleteText(user: Pick<User, "gender" | "age" | "state">, groupInviteLink: string): string {
    const genderText = user.gender
        ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1)
        : "Not Set";
    const genderEmoji = user.gender === "female" ? "👩" : user.gender === "male" ? "👨" : "👤";
    const stateText = user.state === "Other" ? "🌍 Other" : (user.state || "Not Set");

    return (
        "✨ *Profile Complete!* ✨\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "📋 *Your Profile:*\n\n" +
        `${genderEmoji} *Gender:* ${genderText}\n` +
        `🎂 *Age:* ${user.age || "Not Set"}\n` +
        `📍 *Location:* ${stateText}\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "📢 *Want to join our community group?*\n" +
        "Join to meet more people and stay updated!\n" +
        `👉 ${groupInviteLink}\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "🎉 *You're all set to start chatting!*\n" +
        "/search - Find a chat partner now\n" +
        "⚙️ /settings - Update your profile anytime\n" +
        "❓ /help - Get help with commands\n\n" +
        "💡 *Tip:* Be friendly and respectful for the best experience!"
    );
}
