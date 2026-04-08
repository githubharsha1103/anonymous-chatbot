import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { ExtraTelegraf } from '../index';
import { getDatabaseStatus, pingDatabase } from '../storage/db';
import { isAdmin } from '../Utils/adminAuth';

/**
 * Validates webhook URL format
 */
function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

/**
 * Creates and configures the Express web server
 * Handles webhook endpoints and health checks
 */
export function createWebServer(bot: ExtraTelegraf): express.Application {
  const app = express();
  const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/webhook";

  // Store bot reference for health check endpoint
  app.locals.bot = bot;

  // Rate limiting for admin API
  const apiRateLimit = new Map<string, { count: number; resetTime: number }>();
  const API_RATE_LIMIT = 10; // requests per minute
  const API_RATE_WINDOW = 60 * 1000; // 1 minute

  // Use Telegraf's built-in webhook callback
  app.use(bot.webhookCallback(WEBHOOK_PATH));

  // API endpoint to check admin status (secured with API key)
  app.post("/api/check-admin", express.json(), (req: Request, res: Response) => {
    const { userId } = req.body;
    const apiKey = req.headers['x-api-key'] as string;
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

    // Rate limiting check
    const now = Date.now();
    const clientLimit = apiRateLimit.get(clientIP);

    if (clientLimit && now < clientLimit.resetTime) {
      if (clientLimit.count >= API_RATE_LIMIT) {
        return res.status(429).json({ error: "Too many requests" });
      }
      clientLimit.count++;
    } else {
      apiRateLimit.set(clientIP, { count: 1, resetTime: now + API_RATE_WINDOW });
    }

    // Get configured API key - fail if not set
    const configuredApiKey = process.env.WEB_API_KEY;

    // Require API key to be configured in production
    if (!configuredApiKey) {
      // Log once at startup instead of every request
      return res.status(503).json({ error: "Admin API not configured" });
    }

    // Use timing-safe comparison to prevent timing attacks
    if (!apiKey || !configuredApiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      if (!crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(configuredApiKey))) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    } catch {
      // Buffer lengths don't match or other crypto error
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!userId) {
      return res.json({ isAdmin: false });
    }
    const adminStatus = isAdmin(Number(userId));
    res.json({ isAdmin: adminStatus });
  });

  // Health check endpoint - includes database status
  app.get("/health", async (req: Request, res: Response) => {
    const dbStatus = getDatabaseStatus();
    
    // Try to verify MongoDB connection if configured
    let mongoConnected = false;
    if (dbStatus.mode === 'mongodb') {
      mongoConnected = await pingDatabase();
    }
    
    // Check queue health
    const bot = req.app.locals.bot as ExtraTelegraf;
    const queueHealth = {
      regularQueue: {
        size: bot.waitingQueue.length,
        setSize: bot.queueSet.size,
        consistent: bot.waitingQueue.length === bot.queueSet.size
      },
      premiumQueue: {
        size: bot.premiumQueue.length,
        setSize: bot.premiumQueueSet.size,
        consistent: bot.premiumQueue.length === bot.premiumQueueSet.size
      },
      activeChats: bot.runningChats.size,
      totalUsers: bot.totalUsers,
      totalChats: bot.totalChats
    };
    
    // Check memory usage
    const memUsage = process.memoryUsage();
    const memoryHealth = {
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024) // MB
    };
    
    const healthy = dbStatus.mode === 'mongodb'
      ? (dbStatus.healthy && mongoConnected && queueHealth.regularQueue.consistent && queueHealth.premiumQueue.consistent)
      : (dbStatus.healthy && queueHealth.regularQueue.consistent && queueHealth.premiumQueue.consistent);
      
    res.json({
      status: healthy ? "OK" : "DEGRADED",
      database: {
        ...dbStatus,
        mongoConnected
      },
      queues: queueHealth,
      memory: memoryHealth
    });
  });

  // Readiness probe endpoint
  app.get("/ready", (req: Request, res: Response) => {
    res.status(200).send("READY");
  });

  // Root endpoint
  app.get("/", (req: Request, res: Response) => {
    res.status(200).send("OK");
  });

  return app;
}

/**
 * Starts the web server with webhook configuration
 */
export async function startWebServer(
  app: express.Application,
  bot: ExtraTelegraf,
  port: number
): Promise<void> {
  const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/webhook";

  const domain = process.env.WEBHOOK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;

  if (!domain) {
    throw new Error("[ERROR] - Cannot start webhook server: WEBHOOK_URL or RENDER_EXTERNAL_HOSTNAME not set");
  }

  if (!isValidWebhookUrl(domain)) {
    throw new Error(`[ERROR] - Invalid webhook URL: ${domain}. Must be HTTPS or localhost.`);
  }

  const webhookUrl = `${domain}${WEBHOOK_PATH}`;
  const allowedUpdates = [
    "message",
    "callback_query",
    "pre_checkout_query",
    "chat_member",
    "my_chat_member",
    "chat_join_request",
    "inline_query",
    "chosen_inline_result",
    "poll",
    "poll_answer",
    "edited_message",
    "channel_post",
    "edited_channel_post"
  ] as const;

  console.log(`[INFO] - Starting webhook server on port ${port}`);
  console.log(`[INFO] - Webhook URL: ${webhookUrl}`);

  // Track if webhook has been set to prevent duplicate registration
  let webhookSet = false;

  return new Promise<void>((resolve) => {
    const server = app.listen(port, "0.0.0.0", async () => {
      console.log(`[INFO] - Server listening on port ${port}`);
      console.log(`[INFO] - Health check endpoints active`);

      // Only set webhook once
      if (webhookSet) {
        console.log("[INFO] - Webhook already set, skipping duplicate registration");
        resolve();
        return;
      }

      try {
        // Check current webhook info
        const webhookInfo = await bot.telegram.getWebhookInfo();
        
        if (webhookInfo.url === webhookUrl) {
          console.log("[INFO] - Webhook already configured to the same URL");
          webhookSet = true;
          resolve();
          return;
        }

        // Delete any existing webhook first
        if (webhookInfo.url) {
          await bot.telegram.deleteWebhook({});
          console.log("[INFO] - Deleted existing webhook");
        }

        // Set new webhook
        await bot.telegram.setWebhook(webhookUrl, {
          allowed_updates: allowedUpdates
        });
        webhookSet = true;
        console.log("[INFO] - Webhook set successfully");
        console.log(`[INFO] - Webhook allowed updates: ${allowedUpdates.join(", ")}`);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("[ERROR] - Failed to set webhook:", errorMessage);
        // Don't exit - server is still running for health checks
      }

      resolve();
    });

    // Handle server errors
    server.on('error', (err: Error) => {
      console.error("[ERROR] - Server error:", err.message);
    });
  });
}
