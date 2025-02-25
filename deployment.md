# TraderTony v3 - Deployment Instructions

These instructions will help you deploy the TraderTony v3 bot within 1 hour.

## Rapid Deployment Process

### Step 1: Set Up Bot with BotFather (5 minutes)

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Start a chat and send `/newbot`
3. Follow the prompts to create a new bot
   - Provide a name (e.g., "TraderTony")
   - Provide a username (e.g., "TraderTonyV3Bot")
4. **Save the HTTP API token** provided by BotFather

### Step 2: Create Project Structure (10 minutes)

```powershell
# Create project directory
mkdir -p D:\AI Projects\trader-tony-v3
cd D:\AI Projects\trader-tony-v3

# Create necessary directories
mkdir -p src/commands src/keyboards src/utils logs data

# Create .env file from template
Copy-Item .env.example .env
```

### Step 3: Configure Environment (5 minutes)

Edit the `.env` file and replace the placeholder values:

```
# Bot Configuration
TELEGRAM_BOT_TOKEN=12345:ABCDefghIJKlmnOPQRstUVwxYZ  # From BotFather
ADMIN_TELEGRAM_IDS=123456789  # Your Telegram ID

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=  # Leave blank for demo mode
DEMO_WALLET_ADDRESS=2PS57B26Sh5Xa22dPSEt9bRgP5FhNsoyFvGUV8t5X232

# Default Settings
DEFAULT_SLIPPAGE=1
DEFAULT_GAS_PRICE=30
DEFAULT_STOP_LOSS=25
DEFAULT_TAKE_PROFIT=50

# Environment
NODE_ENV=development
LOG_LEVEL=info
```

*Note: To find your Telegram ID, message [@userinfobot](https://t.me/userinfobot) on Telegram.*

### Step 4: Install Dependencies (5 minutes)

```powershell
# Initialize package.json
npm init -y

# Install dependencies
npm install telegraf@4.15.0 dotenv@16.3.1 @solana/web3.js@1.87.6 @solana/spl-token@0.3.8 bs58@5.0.0 winston@3.11.0

# Install dev dependencies
npm install --save-dev nodemon@3.0.1 eslint@8.54.0
```

### Step 5: Start the Bot (5 minutes)

```powershell
# Start the bot
node src/index.js
```

If everything is set up correctly, you should see:
```
TraderTony v3 bot is running...
```

### Step 6: Test the Bot (10 minutes)

1. Open Telegram and search for your bot by username
2. Start a conversation with `/start`
3. Test all the primary buttons:
   - Buy
   - Fund
   - Monitor
   - Limit Orders
   - Wallet
   - Settings
   - DCA Orders
   - Refer Friends
   - Refresh

### Step 7: Production Deployment (Optional, 20 minutes)

For a more permanent deployment:

#### Option 1: Deploy on a VPS

1. Set up a VPS with Node.js installed
2. Clone your repository to the VPS
3. Install PM2: `npm install -g pm2`
4. Start the bot with PM2: `pm2 start src/index.js --name trader-tony-v3`
5. Configure PM2 to start on boot: `pm2 startup` and follow instructions
6. Save the PM2 process list: `pm2 save`

#### Option 2: Deploy on a Cloud Platform

1. Create an account on a platform like Heroku, Railway, or Render
2. Connect your GitHub repository
3. Configure environment variables
4. Deploy the application

## Troubleshooting

### Bot Not Responding

- Verify the bot token is correct
- Make sure the bot is running without errors
- Check the logs: `cat logs/combined.log`

### Telegram API Errors

- The bot might be rate-limited; wait a few minutes
- Ensure your bot token is valid
- Try stopping and restarting the bot

### Solana Connection Issues

- Check if your RPC URL is working
- Try an alternative RPC provider if needed
- For testing, the bot will work in demo mode without a real connection

## Next Steps After Deployment

1. Implement real wallet integration with proper key management
2. Develop actual token sniping functionality
3. Add transaction signing and execution
4. Implement risk analysis for tokens
5. Add monitoring capabilities

## Security Considerations

- **NEVER** commit your `.env` file or private keys to version control
- Use environment variables for all sensitive information
- Consider using a dedicated wallet with limited funds for testing
- Implement proper authentication to restrict access to admin users only