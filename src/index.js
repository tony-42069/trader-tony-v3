// Main entry point for the TraderTony v3 bot
require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { message } = require('telegraf/filters');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Import modules
const keyboards = require('./keyboards');
const commands = require('./commands');
const logger = require('./utils/logger');
const solanaClient = require('./utils/solana');

// Create directories if they don't exist
['logs', 'data'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
});

// Initialize the bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Set up session middleware
bot.use(session());

// Initialize session data for new users
bot.use(async (ctx, next) => {
  if (!ctx.session) {
    // Initialize default session structure
    ctx.session = {
      wallet: {
        address: solanaClient.getWalletAddress() || process.env.DEMO_WALLET_ADDRESS || '2PS57B26Sh5Xa22dPSEt9bRgP5FhNsoyFvGUV8t5X232',
        balance: 0,
        tokens: []
      },
      activeOrders: [],
      settings: {
        slippage: parseInt(process.env.DEFAULT_SLIPPAGE || 1),
        gasPrice: parseInt(process.env.DEFAULT_GAS_PRICE || 30),
        stopLoss: parseInt(process.env.DEFAULT_STOP_LOSS || 25),
        takeProfit: parseInt(process.env.DEFAULT_TAKE_PROFIT || 50)
      },
      snipe: {
        token: null,
        amount: null
      }
    };
    
    // Try to fetch initial wallet data
    try {
      // Only if Solana client is initialized
      if (solanaClient.initialized) {
        ctx.session.wallet.balance = await solanaClient.getBalance();
        // Get token balances if not in demo mode
        if (!solanaClient.demoMode) {
          ctx.session.wallet.tokens = await solanaClient.getTokenBalances();
        }
      }
    } catch (error) {
      logger.warn(`Could not fetch initial wallet data: ${error.message}`);
    }
  }
  return next();
});

// Admin authentication middleware
const adminMiddleware = (ctx, next) => {
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => Number(id.trim()));
  if (adminIds.includes(ctx.from.id)) {
    return next();
  }
  return ctx.reply('🚫 Unauthorized: This bot is currently in private mode.');
};

// Apply admin middleware to all messages
bot.use(adminMiddleware);

// Handle /start command
bot.command('start', commands.handleStart);

// Handle /help command
bot.command('help', commands.handleHelp);

// Handle /balance command
bot.command('balance', commands.handleBalance);

// Handle /snipe command
bot.command('snipe', commands.handleSnipe);

// Handle button clicks
bot.action('buy', commands.handleBuy);
bot.action('fund', commands.handleFund);
bot.action('monitor', commands.handleMonitor);
bot.action('limitOrders', commands.handleLimitOrders);
bot.action('wallet', commands.handleWallet);
bot.action('settings', commands.handleSettings);
bot.action('dcaOrders', commands.handleDCAOrders);
bot.action('referFriends', commands.handleReferFriends);
bot.action('refresh', commands.handleRefresh);

// Handle slippage selection
bot.action(/^slippage_([0-9.]+)$/, (ctx) => commands.handleSlippageSelection(ctx, ctx.match[0]));

// Handle stop-loss/take-profit setup
bot.action(/^sl_tp_([0-9]+)_([0-9]+)$/, (ctx) => commands.handleStopLossTakeProfit(ctx, ctx.match[0]));
bot.action('skip_sl_tp', (ctx) => commands.handleStopLossTakeProfit(ctx, 'skip_sl_tp'));

// Handle force buy for high risk tokens
bot.action(/^force_buy_(.+)_([0-9.]+)_([0-9.]+)$/, (ctx) => commands.handleForceBuy(ctx, ctx.match[0]));
bot.action('cancel_snipe', commands.handleCancelSnipe);

// Handle token address inputs (for buying)
bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  
  // Check if this is a token address (simplified check)
  if (text.length > 30 && text.match(/^[A-Za-z0-9]+$/)) {
    return commands.handleTokenInput(ctx, text);
  }
  
  // Check if this is an amount input
  if (ctx.session.snipe && ctx.session.snipe.token && !ctx.session.snipe.amount) {
    const amount = parseFloat(text);
    if (!isNaN(amount) && amount > 0) {
      return commands.handleAmountInput(ctx, amount);
    }
  }
  
  // Default response for unrecognized messages
  ctx.reply('I don\'t understand this command. Type /help to see available commands.');
});

// Error handling
bot.catch((err, ctx) => {
  logger.error(`Bot error: ${err.message}`);
  ctx.reply('An error occurred while processing your request. Please try again later.');
});

// Start the bot
(async () => {
  try {
    // Initialize Solana client
    await solanaClient.init();
    
    // Launch the bot
    await bot.launch({
      dropPendingUpdates: true
    });
    logger.info('TraderTony v3 bot started successfully');
    console.log('TraderTony v3 bot is running...');
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    logger.error(`Failed to start bot: ${error.message}`);
    console.error('Failed to start bot:', error);
  }
})();