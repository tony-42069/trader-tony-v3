// Script to safely stop all running bot instances
require('dotenv').config();
const axios = require('axios');

async function stopBot() {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    console.log('Stopping bot and clearing webhook...');
    
    // Make API call to delete the webhook
    const response = await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
    
    if (response.data.ok) {
      console.log('Webhook deleted successfully. Bot stopped.');
    } else {
      console.error('Failed to delete webhook:', response.data);
    }
    
    console.log('You can now safely restart the bot with:');
    console.log('  node src/reset-and-start.js');
    
    // On Windows, try to kill any running node processes (optional)
    if (process.platform === 'win32') {
      console.log('\nTo kill all node processes on Windows, run:');
      console.log('  taskkill /F /IM node.exe');
    }
  } catch (error) {
    console.error('Error stopping bot:', error.message);
  }
}

// Execute the stop sequence
stopBot(); 