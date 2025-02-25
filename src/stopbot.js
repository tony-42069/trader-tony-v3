// Script to safely stop all running bot instances
require('dotenv').config();
const axios = require('axios');
const { exec } = require('child_process');
const logger = require('./utils/logger');
const path = require('path');

/**
 * Stop all running bot instances and clear webhook
 */
async function stopBot() {
  try {
    logger.info('Initiating bot shutdown sequence...');
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    console.log('🔄 Stopping bot and clearing Telegram webhook...');
    
    // Make API call to delete the webhook with maximum timeout
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`,
        { timeout: 10000 }
      );
      
      if (response.data.ok) {
        console.log('✅ Webhook deleted successfully.');
        logger.info('Telegram webhook deleted successfully');
      } else {
        console.error('❌ Failed to delete webhook:', response.data);
        logger.error(`Failed to delete webhook: ${JSON.stringify(response.data)}`);
      }
    } catch (webhookError) {
      console.error('❌ Error deleting webhook:', webhookError.message);
      logger.error(`Error deleting webhook: ${webhookError.message}`);
    }
    
    // More targeted process termination based on platform
    console.log('🔄 Terminating bot processes...');
    
    // Get the current directory to help identify our bot's processes
    const currentDir = process.cwd();
    const projectName = path.basename(currentDir);
    
    if (process.platform === 'win32') {
      // Windows - more targeted approach
      try {
        // Find Node.js processes but DON'T kill this process or parent processes
        exec('wmic process where name="node.exe" get commandline, processid', (error, stdout) => {
          if (error) {
            logger.error(`Error getting process list: ${error.message}`);
            return;
          }
          
          // Look for processes that match our project/directory
          const lines = stdout.split('\n');
          const ourProcesses = [];
          
          // Current process ID to avoid killing ourselves
          const currentPid = process.pid.toString();
          
          for (const line of lines) {
            // Only target processes related to our bot (containing our project name or index.js)
            // BUT excluding the current process (stopbot.js)
            if ((line.includes(projectName) || line.includes('index.js')) && 
                line.includes('node') &&
                !line.includes('stopbot.js') &&
                !line.includes(currentPid)) {
                  
              // Extract PID - it's usually at the end of the line
              const parts = line.trim().split(/\s+/);
              const pid = parts[parts.length - 1];
              
              if (pid && /^\d+$/.test(pid) && pid !== currentPid) {
                ourProcesses.push(pid);
              }
            }
          }
          
          if (ourProcesses.length > 0) {
            // Kill each process individually by PID
            ourProcesses.forEach(pid => {
              exec(`taskkill /F /PID ${pid}`, (killError) => {
                if (killError) {
                  logger.error(`Failed to kill process ${pid}: ${killError.message}`);
                } else {
                  logger.info(`Successfully killed bot process with PID: ${pid}`);
                }
              });
            });
            
            console.log(`✅ Terminated ${ourProcesses.length} bot processes.`);
          } else {
            logger.info('No bot processes found to terminate');
            console.log('ℹ️ No running bot processes found.');
          }
        });
      } catch (error) {
        logger.error(`Error terminating processes: ${error.message}`);
        console.error('❌ Error terminating processes:', error.message);
      }
    } else {
      // Linux/Mac command - targeted approach using grep
      try {
        // Find processes containing index.js but not this script
        exec(`ps aux | grep "node.*index.js" | grep -v "stopbot\\.js" | grep -v grep`, (error, stdout) => {
          if (error) {
            // No matching processes found, which is fine
            logger.info('No bot processes found to terminate');
            console.log('ℹ️ No running bot processes found.');
            return;
          }
          
          if (stdout.trim()) {
            const lines = stdout.split('\n').filter(line => line.trim());
            logger.info(`Found ${lines.length} bot processes to terminate`);
            
            // Kill each process
            lines.forEach(line => {
              const pid = line.trim().split(/\s+/)[1];
              if (pid) {
                exec(`kill -9 ${pid}`, (killError) => {
                  if (killError) {
                    logger.error(`Failed to kill process ${pid}: ${killError.message}`);
                  } else {
                    logger.info(`Successfully killed process ${pid}`);
                  }
                });
              }
            });
            
            console.log(`✅ Terminated ${lines.length} bot processes.`);
          }
        });
      } catch (error) {
        logger.error(`Error terminating processes: ${error.message}`);
        console.error('❌ Error terminating processes:', error.message);
      }
    }
    
    logger.info('Bot shutdown sequence completed');
    console.log('\n🔄 Bot has been stopped. You can now restart with:');
    console.log('  node src/index.js');
  } catch (error) {
    logger.error(`Error in stopBot: ${error.message}`);
    console.error('❌ Error stopping bot:', error.message);
  }
}

// Execute the stop sequence
stopBot(); 