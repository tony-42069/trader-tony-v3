// Script to safely stop all running bot instances
require('dotenv').config();
const axios = require('axios');
const { exec } = require('child_process');

async function stopBot() {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    console.log('Stopping bot and clearing webhook...');
    
    // Make API call to delete the webhook
    const response = await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
    
    if (response.data.ok) {
      console.log('Webhook deleted successfully.');
    } else {
      console.error('Failed to delete webhook:', response.data);
    }
    
    // Kill any existing Node.js processes that might be running our bot
    // This is more aggressive but ensures no lingering processes
    console.log('Attempting to kill any running Node.js processes...');
    
    if (process.platform === 'win32') {
      // Windows command
      exec('taskkill /F /IM node.exe', (error, stdout, stderr) => {
        if (error) {
          // It's OK if this fails - it might mean no processes were running
          console.log('Note: No existing Node.js processes needed to be terminated.');
        } else {
          console.log('Successfully terminated Node.js processes.');
        }
        
        console.log('\nBot has been stopped. You can now restart with:');
        console.log('  node src/index.js');
      });
    } else {
      // Linux/Mac command
      exec('pkill -f "node.*index.js"', (error, stdout, stderr) => {
        if (error) {
          // It's OK if this fails - it might mean no processes were running
          console.log('Note: No existing bot processes needed to be terminated.');
        } else {
          console.log('Successfully terminated bot processes.');
        }
        
        console.log('\nBot has been stopped. You can now restart with:');
        console.log('  node src/index.js');
      });
    }
  } catch (error) {
    console.error('Error stopping bot:', error.message);
  }
}

// Execute the stop sequence
stopBot(); 