// Simple script to start the bot without stopping other processes
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const logger = require('./utils/logger');
const fs = require('fs');

/**
 * Start the bot without affecting other processes
 */
async function startBot() {
  try {
    console.log('🚀 TraderTony Bot - Simple Starter');
    console.log('================================');
    
    // Check for Telegram token
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('❌ ERROR: No Telegram bot token found in .env file');
      return;
    }
    
    // Ensure directories exist
    ['logs', 'data'].forEach(dir => {
      if (!fs.existsSync(dir)) {
        console.log(`📁 Creating ${dir} directory...`);
        fs.mkdirSync(dir);
      }
    });
    
    console.log('🚀 Starting TraderTony bot...');
    
    // Start the bot process
    const indexPath = path.join(__dirname, 'index.js');
    
    const botProcess = spawn('node', [indexPath], {
      stdio: 'inherit',
      windowsHide: false
    });
    
    console.log(`✅ Bot started with process ID: ${botProcess.pid}`);
    console.log('📱 Open your Telegram app and message your bot to start using it.');
    console.log('⚠️ Keep this window open to keep the bot running.');
    console.log('🛑 To stop the bot, press Ctrl+C in this window.');
    
    // Handle process exit
    botProcess.on('close', (code) => {
      console.log(`🛑 Bot process exited with code ${code}`);
    });
    
    // Handle errors
    botProcess.on('error', (err) => {
      console.error('❌ Failed to start bot process:', err.message);
    });
    
  } catch (error) {
    console.error('❌ Error starting bot:', error.message);
  }
}

// Start the bot
startBot(); 