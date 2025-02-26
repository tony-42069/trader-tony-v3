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

// Import trading components
const RiskAnalyzer = require('./trading/risk-analyzer');
const TokenSniper = require('./trading/sniper');
const PositionManager = require('./trading/position-manager');
const JupiterClient = require('./utils/jupiter');
const database = require('./utils/database');

// BOOTSTRAP: Create data directories if they don't exist
['logs', 'data'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    logger.info(`Created directory: ${dir}`);
  }
});

// Initialize the bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Set up session middleware
bot.use(session());

// Set up monitoring interval
const MONITORING_UPDATE_INTERVAL = 60000; // 1 minute
setInterval(async () => {
  try {
    // Update token prices and inform users of changes
    await commands.updateMonitoredTokens(bot);
  } catch (error) {
    logger.error(`Error in monitoring update: ${error.message}`);
  }
}, MONITORING_UPDATE_INTERVAL);

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
  // Get admin IDs from environment variable
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => Number(id.trim()));
  
  // Check if this is a private chat from an admin (for sensitive operations)
  const isAdmin = adminIds.includes(ctx.from.id);
  ctx.state.isAdmin = isAdmin; // Store admin status in context state

  // For sensitive commands that should be admin-only
  const adminOnlyCommands = []; // Add sensitive commands here if needed
  
  // If it's an admin-only command, check if user is admin
  if (ctx.message && ctx.message.text && adminOnlyCommands.some(cmd => 
      ctx.message.text.startsWith('/' + cmd))) {
    if (!isAdmin) {
      return ctx.reply('🚫 This command is restricted to bot administrators only.');
    }
  }

  // Allow all users to access basic functionality
  return next();
};

// Apply admin middleware to all messages
bot.use(adminMiddleware);

// BOOTSTRAP: Set up all command handlers
// Core commands
bot.command('start', commands.handleStart);
bot.command('help', commands.handleHelp);
bot.command('balance', commands.handleBalance);

// Trading commands
bot.command('snipe', commands.handleSnipe);
bot.command('buy', commands.handleBuy);
bot.command('positions', commands.handlePositions);

// Wallet commands
bot.command('fund', commands.handleFund);
bot.command('wallet', commands.handleWallet);
bot.command('refresh', commands.handleRefresh);

// BOOTSTRAP: Set up button click handlers
// Main menu buttons
bot.action('snipe', commands.handleSnipe);
bot.action('buy', commands.handleBuy);
bot.action('fund', commands.handleFund);
bot.action('monitor', commands.handleMonitor);
bot.action('positions', commands.handlePositions);
bot.action('limitOrders', commands.handleLimitOrders);
bot.action('wallet', commands.handleWallet);
bot.action('settings', commands.handleSettings);
bot.action('dcaOrders', commands.handleDCAOrders);
bot.action('referFriends', commands.handleReferFriends);
bot.action('refresh', commands.handleRefresh);

// Phantom wallet actions
bot.action('deposit_phantom', commands.handleDepositPhantom);
bot.action('withdraw_phantom', commands.handleWithdrawPhantom);
bot.action('generate_qr', commands.handleGenerateQR);
bot.action('copy_pay_link', commands.handleCopyPayLink);
bot.action(/^withdraw_([0-9.]+)$/, (ctx) => commands.handleWithdrawalAmount(ctx, ctx.match[1]));
bot.action(/^confirm_withdraw_(.+)$/, (ctx) => commands.handleConfirmWithdrawal(ctx, ctx.match[1]));

// Order creation buttons
bot.action('create_limit_buy', commands.handleCreateLimitBuy);
bot.action('create_limit_sell', (ctx) => ctx.reply('Limit sell functionality coming soon!'));
bot.action('create_dca', commands.handleCreateDCA);

// BOOTSTRAP: Set up special action handlers
// Trading setup actions
bot.action(/^slippage_([0-9.]+)$/, (ctx) => commands.handleSlippageSelection(ctx, ctx.match[0]));
bot.action(/^sl_tp_([0-9]+)_([0-9]+)$/, (ctx) => commands.handleStopLossTakeProfit(ctx, ctx.match[0]));
bot.action('skip_sl_tp', (ctx) => commands.handleStopLossTakeProfit(ctx, 'skip_sl_tp'));
bot.action(/^force_buy_(.+)_([0-9.]+)_([0-9.]+)$/, (ctx) => commands.handleForceBuy(ctx, ctx.match[0]));
bot.action('cancel_snipe', commands.handleCancelSnipe);

// Monitor token alerts
bot.action(/alert_(.+)/, async (ctx) => {
  try {
    const tokenAddress = ctx.match[1];
    await commands.handleSetAlert(ctx, tokenAddress);
  } catch (error) {
    logger.error(`Error in alert action: ${error.message}`);
    ctx.reply('Error setting alert. Please try again.');
  }
});

// Stop monitoring token
bot.action(/stop_monitor_(.+)/, async (ctx) => {
  try {
    const tokenAddress = ctx.match[1];
    await commands.handleStopMonitoring(ctx, tokenAddress);
  } catch (error) {
    logger.error(`Error in stop monitoring action: ${error.message}`);
    ctx.reply('Error stopping monitoring. Please try again.');
  }
});

// BOOTSTRAP: Handle text input messages
bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  
  // Handle the current user state if available
  if (ctx.session.state) {
    // Handle waiting for a token address for monitoring
    if (ctx.session.state === 'WAITING_FOR_MONITOR_TOKEN') {
      ctx.session.state = null; // Reset state
      return commands.handleMonitorTokenInput(ctx, text);
    }
    
    // Handle waiting for alert threshold
    if (ctx.session.state === 'WAITING_FOR_ALERT_THRESHOLD' && ctx.session.alertSetup) {
      ctx.session.state = null;
      const { tokenAddress } = ctx.session.alertSetup;
      delete ctx.session.alertSetup;
      return commands.handleAlertThresholdInput(ctx, tokenAddress, text);
    }
    
    // Handle waiting for withdrawal address
    if (ctx.session.state === 'WAITING_FOR_WITHDRAW_ADDRESS') {
      return commands.handleWithdrawAddressInput(ctx, text);
    }
    
    // Handle waiting for a token address for limit buy
    if (ctx.session.state === 'WAITING_FOR_LIMIT_BUY_TOKEN') {
      return commands.handleLimitBuyTokenInput(ctx, text);
    }
    
    // Handle waiting for limit buy price
    if (ctx.session.state === 'WAITING_FOR_LIMIT_BUY_PRICE' && ctx.session.limitBuySetup) {
      return commands.handleLimitBuyPriceInput(ctx, text);
    }
    
    // Handle waiting for limit buy amount
    if (ctx.session.state === 'WAITING_FOR_LIMIT_BUY_AMOUNT' && ctx.session.limitBuySetup) {
      return commands.handleLimitBuyAmountInput(ctx, text);
    }
    
    // Handle waiting for a token address for DCA
    if (ctx.session.state === 'WAITING_FOR_DCA_TOKEN') {
      return commands.handleDCATokenInput(ctx, text);
    }
    
    // Handle waiting for DCA amount
    if (ctx.session.state === 'WAITING_FOR_DCA_AMOUNT' && ctx.session.dcaSetup) {
      return commands.handleDCAAmountInput(ctx, text);
    }
    
    // Handle waiting for DCA interval
    if (ctx.session.state === 'WAITING_FOR_DCA_INTERVAL' && ctx.session.dcaSetup) {
      return commands.handleDCAIntervalInput(ctx, text);
    }
  }
  
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

// BOOTSTRAP: Global error handling with enhanced logging
bot.catch((err, ctx) => {
  logger.error(`Bot error: ${err.message}`);
  logger.error(`Error stack: ${err.stack}`);
  logger.error(`Context: ${JSON.stringify(ctx.update || {})}`);
  
  // Provide a friendly error message to the user
  ctx.reply('❌ An error occurred while processing your request. Please try again later.\n\nIf this persists, use /start to reset the bot.');
});

// Register bot commands with Telegram to make them appear in the menu
async function registerBotCommands() {
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start or restart the bot' },
      { command: 'help', description: 'Show this help message' },
      { command: 'balance', description: 'Show your wallet balance' },
      { command: 'snipe', description: 'Snipe a token' },
      { command: 'buy', description: 'Enter a token to buy' },
      { command: 'fund', description: 'View wallet funding options' },
      { command: 'wallet', description: 'View wallet information' },
      { command: 'refresh', description: 'Update wallet balance' },
      { command: 'positions', description: 'View your open positions' }
    ]);
    logger.info('Bot commands registered with Telegram');
  } catch (error) {
    logger.error(`Failed to register bot commands: ${error.message}`);
  }
}

// Initialize trading components 
const initTradingComponents = async () => {
  try {
    logger.info('Initializing trading components');
    
    // Get connection and wallet from solanaClient
    const connection = solanaClient.connection;
    const wallet = solanaClient.walletManager;
    
    if (!connection) {
      throw new Error('Solana connection not initialized');
    }
    
    const riskAnalyzer = new RiskAnalyzer(connection);
    
    // Initialize position manager
    const positionManager = new PositionManager(connection, wallet);
    
    // Load any existing positions from database
    await positionManager.loadPositions();
    
    // Initialize token sniper with position manager
    const tokenSniper = new TokenSniper(connection, wallet, riskAnalyzer, positionManager);
    
    logger.info('Trading components initialized successfully');
    return { riskAnalyzer, tokenSniper, positionManager };
  } catch (error) {
    logger.error(`Error initializing trading components: ${error.message}`);
    throw error; // Rethrow the error to handle it in the startBot function
  }
};

const startBot = async () => {
  try {
    logger.info('Starting TraderTony v3 bot...');
    
    // Initialize Solana client
    await solanaClient.init();
    logger.info('Solana client initialized successfully');
    
    // Register commands with Telegram
    await registerBotCommands();
    
    // Initialize trading components with better error handling
    let tradingComponents;
    try {
      tradingComponents = await initTradingComponents();
      logger.info('Trading components initialized successfully');
    } catch (error) {
      logger.warn(`Error initializing trading components: ${error.message}`);
      logger.warn('Starting bot with limited functionality');
      
      // Create fallback components with minimal functionality
      const connection = solanaClient.connection || null;
      const wallet = solanaClient.walletManager || { demoMode: true };
      
      tradingComponents = {
        riskAnalyzer: new RiskAnalyzer(connection),
        positionManager: new PositionManager(connection, wallet),
        tokenSniper: null  // Will be created later if needed
      };
    }
    
    // Setup global components for command handlers to access
    global.botComponents = tradingComponents;
    
    // Create token sniper if it doesn't exist yet
    if (!tradingComponents.tokenSniper && tradingComponents.riskAnalyzer && tradingComponents.positionManager) {
      const connection = solanaClient.connection;
      const wallet = solanaClient.walletManager;
      if (connection && wallet) {
        tradingComponents.tokenSniper = new TokenSniper(
          connection, 
          wallet, 
          tradingComponents.riskAnalyzer, 
          tradingComponents.positionManager
        );
      }
    }
    
    // Launch the bot with improved configuration
    await bot.launch({
      dropPendingUpdates: true,
      allowedUpdates: ['message', 'callback_query']
    });
    
    logger.info('TraderTony v3 bot started successfully');
    console.log('🚀 TraderTony v3 bot is running with REAL functionality...');
    console.log(`🔌 Demo mode: ${solanaClient.demoMode ? 'Enabled' : 'Disabled'}`);
    console.log(`💼 Wallet: ${solanaClient.getWalletAddress()}`);
    
    // Enable graceful stop
    process.once('SIGINT', () => {
      logger.info('Received SIGINT signal, stopping bot...');
      bot.stop('SIGINT');
    });
    
    process.once('SIGTERM', () => {
      logger.info('Received SIGTERM signal, stopping bot...');
      bot.stop('SIGTERM');
    });
  } catch (error) {
    logger.error(`Failed to start bot: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    console.error('❌ Failed to start bot:', error.message);
  }
};

// BOOTSTRAP: Start the bot with enhanced error handling
startBot();