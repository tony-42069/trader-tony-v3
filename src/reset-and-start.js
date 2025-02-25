// Script to reset webhook connection and start the bot with proper cleanup
require('dotenv').config();
const axios = require('axios');
const { spawn, exec } = require('child_process');
const path = require('path');
const logger = require('./utils/logger');
const fs = require('fs');

/**
 * Reset Telegram webhook, stop running instances, and start a fresh bot
 */
async function resetAndStart() {
  try {
    logger.info('Starting reset and bot startup sequence');
    console.log('🚀 TraderTony Bot Launcher v3');
    console.log('==========================');
    
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('❌ ERROR: No Telegram bot token found in .env file');
      logger.error('No Telegram bot token found in environment variables');
      process.exit(1);
    }
    
    // 1. Check if required directories exist
    checkDirectories();
    
    // 2. Reset webhook
    await resetWebhook(token);
    
    // 3. Stop bot using our stopbot.js script (safer than direct process killing)
    await stopBotSafely();
    
    // 4. Start bot
    startBot();
    
  } catch (error) {
    console.error('❌ Error during reset and start:', error.message);
    logger.error(`Error during reset and start: ${error.message}`);
    console.error('\nPlease try running manually:');
    console.error('1. node src/stopbot.js');
    console.error('2. node src/index.js');
  }
}

/**
 * Check if required directories exist and create them if needed
 */
function checkDirectories() {
  console.log('🔍 Checking required directories...');
  
  ['logs', 'data'].forEach(dir => {
    if (!fs.existsSync(dir)) {
      console.log(`📁 Creating ${dir} directory...`);
      fs.mkdirSync(dir);
      logger.info(`Created directory: ${dir}`);
    }
  });
  
  console.log('✅ Directory checks completed');
}

/**
 * Reset Telegram webhook
 * @param {string} token - Bot token
 */
async function resetWebhook(token) {
  console.log('🔄 Resetting Telegram webhook connection...');
  
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`,
      { timeout: 10000 }
    );
    
    if (response.data.ok) {
      console.log('✅ Webhook deleted successfully!');
      logger.info('Webhook deleted successfully');
    } else {
      console.error('⚠️ Warning: Failed to delete webhook:', response.data);
      logger.warn(`Failed to delete webhook: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.error('⚠️ Warning: Error resetting webhook -', error.message);
    logger.error(`Error resetting webhook: ${error.message}`);
    // Continue despite webhook error
  }
}

/**
 * Stop bot safely by running stopbot.js
 */
async function stopBotSafely() {
  console.log('🔄 Stopping any running bot instances...');
  
  return new Promise((resolve) => {
    // Run our safer stop script instead of direct process killing
    const stopbotPath = path.join(__dirname, 'stopbot.js');
    
    exec(`node "${stopbotPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('⚠️ Warning:', error.message);
        logger.warn(`Error running stopbot.js: ${error.message}`);
      }
      
      if (stdout) {
        console.log(stdout);
      }
      
      if (stderr) {
        console.error(stderr);
      }
      
      // Add a small delay to ensure processes are terminated
      setTimeout(() => {
        console.log('✅ Previous bot instances stopped');
        resolve();
      }, 2000);
    });
  });
}

/**
 * Start the bot with improved error handling
 */
function startBot() {
  console.log('🚀 Starting bot...');
  logger.info('Starting bot process');
  
  try {
    // Start the main bot process in detached mode
    const indexPath = path.join(__dirname, 'index.js');
    
    const botProcess = spawn('node', [indexPath], {
      detached: true,
      stdio: 'inherit',
      windowsHide: false
    });
    
    // Log process ID
    logger.info(`Bot process started with PID: ${botProcess.pid}`);
    
    // Handle process events
    botProcess.on('error', (err) => {
      console.error('❌ Failed to start bot process:', err.message);
      logger.error(`Failed to start bot process: ${err}`);
    });
    
    // Unref the child process to allow the parent to exit
    botProcess.unref();
    
    console.log('✨ Bot startup sequence completed!');
    console.log('📱 Open your Telegram app and message your bot to start using it.');
    console.log('🛑 To stop the bot later, run: node src/stopbot.js');
    
    // Exit this process after a delay to allow logs to be written
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (error) {
    console.error('❌ Error starting bot:', error.message);
    logger.error(`Error starting bot: ${error.message}`);
  }
}

// Execute the reset and start sequence
resetAndStart(); 