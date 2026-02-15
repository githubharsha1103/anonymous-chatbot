/**
 * External keepalive ping script
 * 
 * This script pings the bot's health endpoint to prevent hosting platforms
 * like Render.com from putting the service to sleep due to inactivity.
 * 
 * Usage:
 *   1. Deploy this bot with ENABLE_SELF_PING=true
 *   2. Set up a cron job to call this script every 5-10 minutes
 * 
 * For Render.com:
 *   - Go to your service settings
 *   - Add a cron job that runs every 5 minutes
 *   - Point it to: https://your-app.onrender.com/healthz
 * 
 * Alternative: Use a free external service like:
 *   - https://cron-job.org
 *   - https://www.easycron.com
 *   - https://uptimerobot.com
 */

const https = require('https');
const http = require('http');

// Get the URL from command line argument or use default
const url = process.argv[2] || process.env.BOT_URL || 'http://localhost:3000/healthz';

console.log(`[PING] - Pinging ${url}...`);

const parsedUrl = new URL(url);
const protocol = parsedUrl.protocol === 'https:' ? https : http;

const req = protocol.get(url, (res) => {
  if (res.statusCode === 200) {
    console.log(`[PING] - Success! Status: ${res.statusCode}`);
    process.exit(0);
  } else {
    console.error(`[PING] - Warning! Status: ${res.statusCode}`);
    process.exit(1);
  }
});

req.on('error', (err) => {
  console.error(`[PING] - Error: ${err.message}`);
  process.exit(1);
});

// Timeout after 10 seconds
req.setTimeout(10000, () => {
  console.error('[PING] - Timeout');
  req.destroy();
  process.exit(1);
});
