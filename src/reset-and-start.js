// Script to reset webhook and start bot
require('dotenv').config();
const axios = require('axios');
const { exec } = require('child_process');

// First delete any existing webhook
const token = process.env.TELEGRAM_BOT_TOKEN;

async function resetAndStart() {
  try {
    console.log('Resetting Telegram webhook connection...');
    
    // Make an API call to delete the webhook
    const response = await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
    
    if (response.data.ok) {
      console.log('Webhook deleted successfully!');
      
      // Wait a moment for Telegram to process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Start the bot
      console.log('Starting bot...');
      require('./index.js');
    } else {
      console.error('Failed to delete webhook:', response.data);
    }
  } catch (error) {
    console.error('Error resetting webhook:', error.message);
  }
}

// Execute the reset and start sequence
resetAndStart(); 