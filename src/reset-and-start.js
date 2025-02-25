// Script to reset webhook connection and start the bot
require('dotenv').config();
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const logger = require('./utils/logger');

async function resetAndStart() {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    console.log('Resetting Telegram webhook connection...');
    
    // Make API call to delete the webhook
    const response = await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
    
    if (response.data.ok) {
      console.log('Webhook deleted successfully!');
    } else {
      console.error('Failed to delete webhook:', response.data);
      return;
    }
    
    console.log('Starting bot...');
    
    // Start the main bot process
    const botProcess = spawn('node', [path.join(__dirname, 'index.js')], {
      detached: true,
      stdio: 'inherit'
    });
    
    // Log any errors
    botProcess.on('error', (err) => {
      console.error('Failed to start bot process:', err);
    });
    
    // Unref the child process so the parent can exit
    botProcess.unref();
  } catch (error) {
    console.error('Error during reset and start:', error.message);
  }
}

// Execute the reset and start sequence
resetAndStart(); 