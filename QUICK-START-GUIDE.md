# TraderTony v3 - Quick Start Guide

This guide will help you deploy a functional TraderTony Telegram bot within 1 hour.

## 60-Minute Deployment Plan

### Prerequisites (5 minutes)
- Node.js 18+ installed
- VS Code with PowerShell terminal
- Telegram account
- Telegram Bot Token (from BotFather)

### Step 1: Project Setup (5 minutes)
```powershell
# Create project directory
mkdir -p D:\AI Projects\trader-tony-v3
cd D:\AI Projects\trader-tony-v3

# Initialize project
npm init -y

# Install dependencies
npm install telegraf@4.15.0 dotenv@16.3.1 @solana/web3.js@1.87.6 @solana/spl-token@0.3.8 bs58@5.0.0 winston@3.11.0
```

### Step 2: Environment Setup (5 minutes)
Create a `.env` file in the project root:
```
# Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ADMIN_TELEGRAM_IDS=your_telegram_id

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_base58_private_key_if_available

# Default Settings
DEFAULT_SLIPPAGE=1
DEFAULT_GAS_PRICE=30
DEFAULT_STOP_LOSS=25
DEFAULT_TAKE_PROFIT=50
```

### Step 3: Create Bot Structure (10 minutes)
Create these files in your project:

#### src/index.js
The main entry point that sets up the bot.

#### src/commands/index.js
Define all bot commands and handlers.

#### src/keyboards/index.js
Define the keyboard layouts for the bot interface.

#### src/utils/logger.js
Set up logging functionality.

#### src/utils/solana.js
Basic Solana wallet integration.

### Step 4: Implement Core Functionality (20 minutes)
- Set up the Telegram bot interface with buttons as shown in the screenshot
- Implement basic wallet display
- Create placeholder functions for core features
- Add "demo mode" for trading features

### Step 5: Test and Deploy (15 minutes)
```powershell
# Start the bot
node src/index.js
```

Test the bot by messaging it on Telegram. Verify:
- Welcome message displays correctly
- Buttons work and show appropriate responses
- Wallet information displays correctly

## Post-Launch Plan

After the initial launch, focus on implementing real functionality in this order:

1. Real wallet balance tracking
2. Basic token sniping functionality
3. Transaction signing and execution
4. Stop-loss and take-profit features
5. Risk analysis implementation

## Common Issues & Fixes

### Bot Not Responding
- Verify the bot token is correct
- Check that the bot is running without errors
- Ensure you've messaged the correct bot username

### Connection Errors
- Verify your Solana RPC URL is working
- Try an alternative RPC provider if needed

### Permission Issues
- Ensure the admin Telegram IDs are set correctly
- Verify environment variables are being loaded properly

## Quick Command Reference

```powershell
# Start the bot
npm start

# Restart the bot
npm restart

# Check logs
cat logs/bot.log
```