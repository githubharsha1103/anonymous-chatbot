/**
 * Reset Telegram Bot Offset Script
 * Run this to clear any stuck getUpdates requests
 * 
 * Usage: npx ts-node resetOffset.ts
 * Or: node resetOffset.js (after building)
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not found in .env file');
  process.exit(1);
}

async function resetOffset() {
  console.log('🔄 Resetting bot offset...\n');

  try {
    // 1. Get current updates to see what's happening
    console.log('1️⃣ Getting current updates status...');
    const statusRes = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`,
      { params: { offset: -1, limit: 1, timeout: 1 } }
    );
    console.log(`   Updates in queue: ${statusRes.data.result?.length || 0}`);

    // 2. Clear offset by sending a high offset
    console.log('\n2️⃣ Clearing offset...');
    const clearRes = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`,
      { params: { offset: 999999999, timeout: 1 } }
    );
    console.log('   ✅ Offset cleared successfully');

    // 3. Delete any webhook (if exists)
    console.log('\n3️⃣ Checking for webhooks...');
    const webhookInfo = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`
    );
    
    if (webhookInfo.data.result.url) {
      console.log(`   Found webhook: ${webhookInfo.data.result.url}`);
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
      console.log('   ✅ Webhook deleted');
    } else {
      console.log('   No webhook found (using long polling)');
    }

    // 4. Get updates with offset 0 to confirm
    console.log('\n4️⃣ Verifying reset...');
    const verifyRes = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`,
      { params: { offset: 0, limit: 1, timeout: 10 } }
    );
    console.log(`   ✅ Bot is ready. Pending updates: ${verifyRes.data.result?.length || 0}`);

    console.log('\n✨ Offset reset complete! You can now restart your bot.');
    console.log('   Make sure to run only ONE instance of the bot.\n');

  } catch (error: any) {
    if (error.response?.data?.error_code === 409) {
      console.log('\n❌ 409 Conflict still occurring!');
      console.log('   This means another instance is still running.');
      console.log('   Please:');
      console.log('   1. Close ALL terminals running the bot');
      console.log('   2. Check Task Manager for node.exe processes and end them');
      console.log('   3. Try running this script again');
    } else {
      console.error('\n❌ Error:', error.response?.data?.description || error.message);
    }
  }
}

resetOffset();
