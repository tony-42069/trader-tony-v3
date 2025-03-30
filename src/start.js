// Simple start script for TraderTony v3
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('========================================');
console.log('🤖 TraderTony v3 - Memecoin Sniper Bot');
console.log('========================================');
console.log('Starting bot...');

// Function to check if required files exist
function checkRequiredFiles() {
  const requiredFiles = [
    'src/index.js',
    '.env'
  ];
  
  let missingFiles = [];
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      missingFiles.push(file);
    }
  }
  
  if (missingFiles.length > 0) {
    console.error('❌ Error: The following required files are missing:');
    missingFiles.forEach(file => console.error(`   - ${file}`));
    return false;
  }
  
  return true;
}

// Function to check .env configuration
function checkEnvConfiguration() {
  try {
    // Load .env file
    const envContent = fs.readFileSync('.env', 'utf8');
    const envLines = envContent.split('\n');
    
    // Required configuration keys
    const requiredKeys = [
      'TELEGRAM_BOT_TOKEN',
      'ADMIN_TELEGRAM_IDS',
      'SOLANA_RPC_URL'
    ];
    
    const foundKeys = {};
    let missingKeys = [];
    
    // Check for required keys
    envLines.forEach(line => {
      if (line.trim() && !line.startsWith('#')) {
        const parts = line.split('=');
        if (parts.length >= 2 && parts[0].trim()) {
          const key = parts[0].trim();
          foundKeys[key] = true;
        }
      }
    });
    
    requiredKeys.forEach(key => {
      if (!foundKeys[key]) {
        missingKeys.push(key);
      }
    });
    
    if (missingKeys.length > 0) {
      console.error('❌ Error: The following required environment variables are missing:');
      missingKeys.forEach(key => console.error(`   - ${key}`));
      return false;
    }
    
    console.log('✅ Environment configuration validated');
    return true;
  } catch (error) {
    console.error(`❌ Error reading .env file: ${error.message}`);
    return false;
  }
}

// Function to start the bot
function startBot() {
  const botPath = path.join(__dirname, 'index.js');
  
  console.log(`📂 Launching bot from: ${botPath}`);
  
  // Create a child process for the bot
  const child = exec(`node "${botPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Bot execution error: ${error.message}`);
      return;
    }
  });
  
  // Output process ID for tracking
  console.log(`🚀 Bot started with PID: ${child.pid}`);
  
  // Handle output streams
  child.stdout.on('data', (data) => {
    console.log(`${data.trim()}`);
  });
  
  child.stderr.on('data', (data) => {
    console.error(`❌ ERROR: ${data.trim()}`);
  });
  
  // Handle process exit
  child.on('exit', (code) => {
    if (code === 0) {
      console.log('✅ Bot process exited cleanly');
    } else {
      console.error(`❌ Bot process exited with code ${code}`);
    }
  });
  
  // Handle process error
  child.on('error', (error) => {
    console.error(`❌ Bot process error: ${error.message}`);
  });
  
  console.log('');
  console.log('✅ Bot is now running.');
  console.log('📱 Open Telegram and message your bot to start trading.');
  console.log('🔍 The memecoin sniper is now active and scanning for opportunities.');
  console.log('⚠️ Keep this window open to keep the bot running.');
  console.log('⛔ Press Ctrl+C to stop the bot.');
  console.log('');
}

// Main execution
if (checkRequiredFiles() && checkEnvConfiguration()) {
  startBot();
} else {
  console.error('❌ Startup failed due to missing or invalid configuration.');
  process.exit(1);
} 