/**
 * Script to cleanly restart the TraderTony bot
 * This script will:
 * 1. Delete the Telegram webhook
 * 2. Terminate any running bot processes
 * 3. Start a fresh bot instance
 */

const axios = require('axios');
const { exec } = require('child_process');
const path = require('path');
const logger = require('./utils/logger');
const config = require('./config');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  logger.info(`Created data directory at ${dataDir}`);
}

/**
 * Delete the bot's webhook
 */
async function deleteWebhook() {
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`
    );
    if (response.data.ok) {
      logger.info('Telegram webhook deleted successfully');
      return true;
    } else {
      logger.error(`Failed to delete webhook: ${response.data.description}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error deleting webhook: ${error.message}`);
    return false;
  }
}

/**
 * Kill any running bot processes
 */
function killBotProcesses() {
  return new Promise((resolve) => {
    // Different command based on OS
    const isWindows = process.platform === 'win32';
    const cmd = isWindows
      ? 'taskkill /F /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq *trader-tony*"'
      : "ps aux | grep 'node.*trader-tony' | grep -v grep | awk '{print $2}' | xargs -r kill -9";

    exec(cmd, (error) => {
      if (error) {
        logger.info('No previous bot processes found or could not kill processes');
      } else {
        logger.info('Previous bot processes terminated');
      }
      
      // Small delay to ensure ports are freed
      setTimeout(resolve, 1000);
    });
  });
}

/**
 * Start the bot in a detached process
 */
function startBot() {
  return new Promise((resolve) => {
    const botPath = path.join(__dirname, 'index.js');
    
    const child = exec(`node ${botPath}`, (error) => {
      if (error) {
        logger.error(`Failed to start bot: ${error.message}`);
      }
    });
    
    // Detach the process
    if (child.unref) {
      child.unref();
    }
    
    logger.info('Bot has been started in a separate process');
    resolve();
  });
}

/**
 * Main function to reset and start the bot
 */
async function resetAndStart() {
  try {
    logger.info('Starting bot reset procedure...');
    
    // Step 1: Delete webhook
    await deleteWebhook();
    
    // Step 2: Kill existing processes
    await killBotProcesses();
    
    // Step 3: Start the bot
    await startBot();
    
    logger.info('Bot has been successfully reset and started');
    
    // Exit this process after a delay
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  } catch (error) {
    logger.error(`Failed to reset and start bot: ${error.message}`);
    process.exit(1);
  }
}

// Run the reset and start procedure
resetAndStart(); 