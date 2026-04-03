import { Markup } from "telegraf";
import type { User } from "../storage/db";

export type SetupStep =
    | "gender"
    | "age"
    | "age_manual"
    | "state"
    | "state_north"
    | "state_south"
    | "state_east"
    | "state_west"
    | "state_central"
    | "state_northeast"
    | "state_ut"
    | "state_other"
    | "done";

export type LocationOption = {
    name: string;
    code: string;
    storedValue: string;
};

export const indianLocationOptions: readonly LocationOption[] = [
    { name: "Andhra Pradesh", code: "AP", storedValue: "Andhra Pradesh" },
    { name: "Arunachal Pradesh", code: "AR", storedValue: "Arunachal Pradesh" },
    { name: "Assam", code: "AS", storedValue: "Assam" },
    { name: "Bihar", code: "BR", storedValue: "Bihar" },
    { name: "Chhattisgarh", code: "CG", storedValue: "Chhattisgarh" },
    { name: "Goa", code: "GA", storedValue: "Goa" },
    { name: "Gujarat", code: "GJ", storedValue: "Gujarat" },
    { name: "Haryana", code: "HR", storedValue: "Haryana" },
    { name: "Himachal Pradesh", code: "HP", storedValue: "Himachal Pradesh" },
    { name: "Jharkhand", code: "JH", storedValue: "Jharkhand" },
    { name: "Karnataka", code: "KA", storedValue: "Karnataka" },
    { name: "Kerala", code: "KL", storedValue: "Kerala" },
    { name: "Madhya Pradesh", code: "MP", storedValue: "Madhya Pradesh" },
    { name: "Maharashtra", code: "MH", storedValue: "Maharashtra" },
    { name: "Manipur", code: "MN", storedValue: "Manipur" },
    { name: "Meghalaya", code: "ML", storedValue: "Meghalaya" },
    { name: "Mizoram", code: "MZ", storedValue: "Mizoram" },
    { name: "Nagaland", code: "NL", storedValue: "Nagaland" },
    { name: "Odisha", code: "OD", storedValue: "Odisha" },
    { name: "Punjab", code: "PB", storedValue: "Punjab" },
    { name: "Rajasthan", code: "RJ", storedValue: "Rajasthan" },
    { name: "Sikkim", code: "SK", storedValue: "Sikkim" },
    { name: "Tamil Nadu", code: "TN", storedValue: "Tamil Nadu" },
    { name: "Telangana", code: "TS", storedValue: "Telangana" },
    { name: "Tripura", code: "TR", storedValue: "Tripura" },
    { name: "Uttar Pradesh", code: "UP", storedValue: "Uttar Pradesh" },
    { name: "Uttarakhand", code: "UK", storedValue: "Uttarakhand" },
    { name: "West Bengal", code: "WB", storedValue: "West Bengal" },
    { name: "Andaman & Nicobar Islands", code: "AN", storedValue: "Andaman & Nicobar" },
    { name: "Chandigarh", code: "CH", storedValue: "Chandigarh" },
    { name: "Dadra & Nagar Haveli and Daman & Diu", code: "DNDD", storedValue: "Dadra & Nagar Haveli and Daman & Diu" },
    { name: "Delhi", code: "DL", storedValue: "Delhi" },
    { name: "Jammu & Kashmir", code: "JK", storedValue: "Jammu & Kashmir" },
    { name: "Ladakh", code: "LA", storedValue: "Ladakh" },
    { name: "Lakshadweep", code: "LD", storedValue: "Lakshadweep" },
    { name: "Puducherry", code: "PY", storedValue: "Puducherry" },
    { name: "Outside India", code: "OTHER", storedValue: "Other" }
] as const;

export const locationValues = indianLocationOptions.map((option) => option.storedValue);

function buildLocationKeyboard(callbackPrefix: string, backCallback?: string) {
    const rows = indianLocationOptions.map((option) => [
        Markup.button.callback(option.name, `${callbackPrefix}${option.code}`)
    ]);

    if (backCallback) {
        rows.push([Markup.button.callback("⬅️ Back", backCallback)]);
    }

    return Markup.inlineKeyboard(rows);
}

export const setupStateKeyboardPage1 = buildLocationKeyboard("SETUP_STATE_");
export const settingsStateKeyboard = buildLocationKeyboard("STATE_", "OPEN_SETTINGS");

export const setupGenderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

export const setupAgeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("15", "SETUP_AGE_13_17")],
    [Markup.button.callback("22", "SETUP_AGE_18_25")],
    [Markup.button.callback("33", "SETUP_AGE_26_40")],
    [Markup.button.callback("45", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
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
                    "🎂 *Select your age:*\n" +
                    "(Choose the option closest to your age)",
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
        case "state_north":
        case "state_south":
        case "state_east":
        case "state_west":
        case "state_central":
        case "state_northeast":
        case "state_ut":
            return {
                text:
                    "📝 *Step 3 of 3*\n\n" +
                    "📍 *Select your location:*\n" +
                    "(Choose your Indian state/territory)",
                keyboard: setupStateKeyboardPage1
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
                "🎂 *Select your age:*\n" +
                "(Choose the option closest to your age)",
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
                "(Choose your Indian state/territory)",
            keyboard: setupStateKeyboardPage1
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
