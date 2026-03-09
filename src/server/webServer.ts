import express, { Request, Response } from 'express';
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

  // Use Telegraf's built-in webhook callback
  app.use(bot.webhookCallback(WEBHOOK_PATH));

  // API endpoint to check admin status (secured with API key)
  app.post("/api/check-admin", express.json(), (req: Request, res: Response) => {
    const { userId } = req.body;
    const apiKey = req.headers['x-api-key'] as string;
    
    // Get configured API key - fail if not set
    const configuredApiKey = process.env.WEB_API_KEY;
    
    // Require API key to be configured in production
    if (!configuredApiKey) {
      // Log once at startup instead of every request
      return res.status(503).json({ error: "Admin API not configured" });
    }
    
    // Verify API key matches
    if (apiKey !== configuredApiKey) {
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
    
    const healthy = dbStatus.mode === 'mongodb'
      ? (dbStatus.healthy && mongoConnected)
      : dbStatus.healthy;
    res.json({
      status: healthy ? "OK" : "DEGRADED",
      database: {
        ...dbStatus,
        mongoConnected
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Health check endpoints for Render
  app.get("/healthz", (req: Request, res: Response) => {
    res.status(200).send("OK");
  });

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
  
  // Validate webhook URL before starting
  const domain = process.env.WEBHOOK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  
  if (!domain) {
    console.error("[ERROR] - Cannot start webhook server: WEBHOOK_URL or RENDER_EXTERNAL_HOSTNAME not set");
    process.exit(1);
  }
  
  if (!isValidWebhookUrl(domain)) {
    console.error(`[ERROR] - Invalid webhook URL: ${domain}. Must be HTTPS or localhost.`);
    process.exit(1);
  }
  
  const webhookUrl = `${domain}${WEBHOOK_PATH}`;
  
  console.log(`[INFO] - Starting webhook server on port ${port}`);
  console.log(`[INFO] - Webhook URL: ${webhookUrl}`);

  // Start server first, then set webhook
  return new Promise((resolve) => {
    app.listen(port, "0.0.0.0", async () => {
      console.log(`[INFO] - Server listening on port ${port}`);
      console.log(`[INFO] - Health check endpoints active`);
      
      // Set webhook AFTER server is listening
      try {
        // Delete any existing webhook first
        await bot.telegram.deleteWebhook({});
        console.log("[INFO] - Deleted existing webhook");
        
        // Set new webhook
        await bot.telegram.setWebhook(webhookUrl);
        console.log("[INFO] - Webhook set successfully");
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("[ERROR] - Failed to set webhook:", errorMessage);
        // Don't exit - bot can still work in polling mode if webhook fails
      }
      
      resolve();
    });
  });
}
