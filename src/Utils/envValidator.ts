/**
 * Environment Validator
 * Validates required environment variables at startup
 */

interface EnvConfig {
  BOT_TOKEN: string;
  ADMIN_IDS: string;
  GROUP_CHAT_ID: string;
  MONGODB_URI?: string;
  PORT?: string;
  WEBHOOK_PATH?: string;
  WEBHOOK_URL?: string;
  RENDER_EXTERNAL_HOSTNAME?: string;
  GROUP_INVITE_LINK?: string;
  WEB_API_KEY?: string;
}

const requiredEnv: (keyof EnvConfig)[] = ["BOT_TOKEN", "ADMIN_IDS", "GROUP_CHAT_ID"];
const recommendedEnv: (keyof EnvConfig)[] = ["MONGODB_URI", "GROUP_INVITE_LINK"];

/**
 * Validate required environment variables
 */
export function validateEnvironment(): void {
  // Validate required environment variables
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      console.error(`[FATAL] Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  // Validate recommended environment variables
  for (const key of recommendedEnv) {
    if (!process.env[key]) {
      console.warn(`[WARN] Recommended environment variable not set: ${key}`);
    }
  }

  // Detect production mode
  if (isProduction()) {
    console.log("[INFO] - Running in PRODUCTION mode (webhook)");
    if (!process.env.WEBHOOK_URL && !process.env.RENDER_EXTERNAL_HOSTNAME) {
      console.error("[FATAL] In production mode but WEBHOOK_URL or RENDER_EXTERNAL_HOSTNAME not set");
      process.exit(1);
    }
    
    // Check for WEB_API_KEY in production (required for admin API)
    if (!process.env.WEB_API_KEY) {
      console.warn("[WARN] WEB_API_KEY not set - admin API endpoints will return 503");
    } else if (process.env.WEB_API_KEY.length < 16) {
      console.warn("[WARN] WEB_API_KEY is too short (minimum 16 characters recommended)");
    } else {
      console.log("[INFO] - WEB_API_KEY configured for admin API security");
    }
  } else {
    console.log("[INFO] - Running in DEVELOPMENT mode (polling)");
  }

  // MongoDB configuration check
  const useMongoDB = !!process.env.MONGODB_URI;
  if (useMongoDB) {
    console.log("[INFO] - MongoDB URI detected, will use MongoDB for data storage");
  } else {
    console.warn("[WARN] - MONGODB_URI not set; running in JSON fallback mode only.");
    console.warn("[WARN] - This may degrade performance and reliability for production use.");
  }

  validateAdminIds();
  validateGroupChatId();
  validateWebhookUrl();
}

/**
 * Check if running in production mode (webhook)
 */
export const isProduction = (): boolean => {
  return !!(process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL);
};

function validateAdminIds(): void {
  const raw = process.env.ADMIN_IDS || "";
  const ids = raw.split(",").map(v => v.trim()).filter(Boolean);
  if (ids.length === 0) {
    console.error("[FATAL] ADMIN_IDS must contain at least one numeric Telegram user ID.");
    process.exit(1);
  }
  const invalid = ids.filter(id => !/^\d+$/.test(id));
  if (invalid.length > 0) {
    console.error(`[FATAL] ADMIN_IDS contains invalid values: ${invalid.join(", ")}. Use comma-separated numeric IDs only.`);
    process.exit(1);
  }
}

function validateGroupChatId(): void {
  const groupChatId = process.env.GROUP_CHAT_ID || "";
  // Telegram supergroup IDs are typically negative numeric values (e.g. -100123...)
  if (!/^-?\d+$/.test(groupChatId)) {
    console.error("[FATAL] GROUP_CHAT_ID must be a numeric chat ID (example: -1001234567890).");
    process.exit(1);
  }
}

function validateWebhookUrl(): void {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }
  try {
    const parsed = new URL(webhookUrl);
    if (parsed.protocol !== "https:") {
      console.error("[FATAL] WEBHOOK_URL must use HTTPS.");
      process.exit(1);
    }
  } catch {
    console.error("[FATAL] WEBHOOK_URL is not a valid URL.");
    process.exit(1);
  }
}
