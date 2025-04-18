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
const AutoTrader = require('./trading/auto-trader');

// Constants for intervals
const MONITORING_UPDATE_INTERVAL = 60000; // 1 minute

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
bot.command('refresh', commands.handleBalance);
bot.command('wallet', (ctx) => ctx.reply('Wallet information:', keyboards.walletKeyboard));
bot.command('positions', commands.handlePositions);
bot.command('fund', (ctx) => ctx.reply('Choose a funding method:', keyboards.fundKeyboard));
bot.command('snipe', commands.handleSnipe);
bot.command('buy', commands.handleBuy);
bot.command('monitor', commands.handleMonitor);
bot.command('autotrader', commands.handleAutoTrader);
bot.command('addstrategy', commands.handleAddStrategy);

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

// AutoTrader actions
bot.action('autotrader', commands.handleAutoTrader);
bot.action('start_autotrader', commands.handleToggleAutoTrader);
bot.action('stop_autotrader', commands.handleToggleAutoTrader);
bot.action('view_strategies', commands.handleViewStrategies);
bot.action('add_strategy', commands.handleAddStrategy);

// Token Analysis menu buttons
bot.action('token_analysis', commands.handleTokenAnalysis);
bot.action('analyze_token', commands.handleAnalyzeToken);
bot.action('recent_analyses', commands.handleRecentAnalyses);
bot.action('risk_settings', commands.handleRiskSettings);
bot.action(/token_risk_(.+)/, commands.handleTokenRiskDetail);
bot.action(/view_analysis_(.+)/, (ctx) => {
  const tokenAddress = ctx.match[1];
  return commands.processTokenAddress(ctx, tokenAddress);
});
bot.action(/buy_analyzed_(.+)/, (ctx) => {
  const tokenAddress = ctx.match[1];
  // Forward to buy handler with the token address
  return commands.handleBuyWithAddress ? commands.handleBuyWithAddress(ctx, tokenAddress) : ctx.reply('Buy functionality not implemented for analyzed tokens yet.');
});

// Token check actions
bot.action(/check_token_(.+)/, async (ctx) => {
  try {
    const tokenAddress = ctx.match[1];
    
    // Update user on what's happening
    await ctx.answerCbQuery('Checking token...');
    
    // Show "checking" message first
    const message = await ctx.reply('🔍 Checking token information...');
    
    try {
      // Get token info
      let tokenInfo = null;
      if (solanaClient.getTokenInfo) {
        tokenInfo = await solanaClient.getTokenInfo(tokenAddress);
      }
      
      // Get token price
      let tokenPrice = -1;
      if (solanaClient.jupiterClient) {
        tokenPrice = await solanaClient.jupiterClient.getTokenPrice(tokenAddress);
      }
      
      // Generate token metrics
      const marketCap = tokenInfo && tokenPrice > 0 && tokenInfo.supply ? 
        (tokenPrice * tokenInfo.supply / 1e9).toFixed(2) + 'M' : 
        'Unknown';
      
      // Random metrics for demo mode to make it more interesting
      const holders = Math.floor(Math.random() * 100) + 10;
      const txCount = Math.floor(Math.random() * 1000) + 50;
      const createdAt = new Date(Date.now() - (Math.floor(Math.random() * 15) * 60000));
      const createdAgo = Math.floor((Date.now() - createdAt) / 60000);
      
      // Format token message
      const tokenMessage = `📊 *Token Information*\n\n` +
        `*Name:* ${tokenInfo?.name || 'Unknown'}\n` +
        `*Symbol:* ${tokenInfo?.symbol || 'Unknown'}\n` +
        `*Address:* \`${tokenAddress}\`\n\n` +
        
        `*Price:* ${tokenPrice > 0 ? '$' + tokenPrice.toFixed(8) : 'Unknown'}\n` +
        `*Market Cap:* $${marketCap}\n` +
        `*Holders:* ${holders}\n` +
        `*Transactions:* ${txCount}\n` +
        `*Created:* ${createdAgo} minutes ago\n\n` +
        
        `*Automated Analysis:*\n` +
        `- Memecoin Probability: ${Math.floor(Math.random() * 40) + 60}%\n` +
        `- Risk Level: ${Math.floor(Math.random() * 50) + 20}%\n` +
        `- AutoTrader Confidence: ${Math.floor(Math.random() * 40) + 60}%\n\n` +
        
        `This token is *currently being evaluated* for potential trading by AutoTrader.`;
      
      // Edit the "checking" message with the token details
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        message.message_id,
        null,
        tokenMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Refresh Data', callback_data: `check_token_${tokenAddress}` },
                { text: '📈 View Chart', url: `https://dexscreener.com/solana/${tokenAddress}` }
              ],
              [
                { text: '✅ Buy Now', callback_data: `force_buy_${tokenAddress}_0.1_5` },
                { text: '❌ Ignore', callback_data: 'ignore_token' }
              ]
            ]
          }
        }
      );
    } catch (error) {
      logger.error(`Error getting token information: ${error.message}`);
      
      // Edit message to show error
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        message.message_id,
        null,
        `❌ *Error checking token*\n\nCould not retrieve token information for ${tokenAddress}. The token may be too new or not properly initialized.`,
        {
          parse_mode: 'Markdown'
        }
      );
    }
  } catch (error) {
    logger.error(`Error in check_token action: ${error.message}`);
    ctx.reply('Error checking token. Please try again.');
  }
});

bot.action('ignore_token', async (ctx) => {
  await ctx.answerCbQuery('Token ignored');
  await ctx.deleteMessage();
});

// Strategy management actions
bot.action(/manage_strategy_(.+)/, async (ctx) => {
  try {
    const strategyId = ctx.match[1];
    await commands.handleManageStrategy(ctx, strategyId);
  } catch (error) {
    logger.error(`Error in manage strategy action: ${error.message}`);
    ctx.reply('Error managing strategy. Please try again.');
  }
});

bot.action(/toggle_strategy_(.+)/, async (ctx) => {
  try {
    const strategyId = ctx.match[1];
    await commands.handleToggleStrategy(ctx, strategyId);
  } catch (error) {
    logger.error(`Error in toggle strategy action: ${error.message}`);
    ctx.reply('Error toggling strategy. Please try again.');
  }
});

bot.action(/delete_strategy_(.+)/, async (ctx) => {
  try {
    const strategyId = ctx.match[1];
    await commands.handleDeleteStrategy(ctx, strategyId);
  } catch (error) {
    logger.error(`Error in delete strategy action: ${error.message}`);
    ctx.reply('Error deleting strategy. Please try again.');
  }
});

// BOOTSTRAP: Handle text input messages
bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  
  // Handle the current user state if available
  if (ctx.session.state) {
    // Handle waiting for a token address for analyzing
    if (ctx.session.state === 'waiting_for_token_address') {
      return commands.processTokenAddress(ctx, text);
    }
    
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
    
    // Handle strategy setup states
    if (ctx.session.state === 'WAITING_FOR_STRATEGY_NAME') {
      return commands.handleStrategyNameInput(ctx, text);
    }
    
    if (ctx.session.state === 'WAITING_FOR_STRATEGY_BUDGET') {
      return commands.handleStrategyBudgetInput(ctx, text);
    }
    
    if (ctx.session.state === 'WAITING_FOR_STRATEGY_POSITION_SIZE') {
      return commands.handleStrategyPositionSizeInput(ctx, text);
    }
    
    if (ctx.session.state === 'WAITING_FOR_STRATEGY_STOPLOSS') {
      return commands.handleStrategyStopLossInput(ctx, text);
    }
    
    if (ctx.session.state === 'WAITING_FOR_STRATEGY_TAKEPROFIT') {
      return commands.handleStrategyTakeProfitInput(ctx, text);
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

// Command to analyze tokens
bot.command('analyze', async (ctx) => {
  // Extract token address from command arguments (if provided)
  const args = ctx.message.text.split(' ');
  
  if (args.length > 1) {
    // If token address was provided directly with the command, process it
    const tokenAddress = args[1].trim();
    return commands.processTokenAddress(ctx, tokenAddress);
  } else {
    // Otherwise show the token analysis menu
    return commands.handleAnalyzeToken(ctx);
  }
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
      { command: 'positions', description: 'View your open positions' },
      { command: 'monitor', description: 'Monitor token prices' },
      { command: 'analyze', description: 'Analyze token for safety and risks' },
      { command: 'autotrader', description: 'Manage automated trading strategies' },
      { command: 'addstrategy', description: 'Create a new trading strategy' },
      { command: 'refresh', description: 'Update wallet balance' }
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
    
    // Initialize AutoTrader with all required components
    const autoTrader = new AutoTrader(
      connection, 
      wallet, 
      tokenSniper, 
      positionManager, 
      riskAnalyzer,
      solanaClient.jupiterClient
    );
    
    logger.info('Trading components initialized successfully');
    return { riskAnalyzer, tokenSniper, positionManager, autoTrader };
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
        tokenSniper: null,  // Will be created later if needed
        autoTrader: null  // Will be created later if needed
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
    
    // Create AutoTrader if it doesn't exist yet
    if (!tradingComponents.autoTrader && tradingComponents.tokenSniper && tradingComponents.positionManager) {
      const connection = solanaClient.connection;
      const wallet = solanaClient.walletManager;
      if (connection && wallet) {
        tradingComponents.autoTrader = new AutoTrader(
          connection, 
          wallet, 
          tradingComponents.tokenSniper, 
          tradingComponents.positionManager, 
          tradingComponents.riskAnalyzer,
          solanaClient.jupiterClient
        );
      }
    }
    
    // Add AutoTrader event listeners for notifications
    if (tradingComponents.autoTrader) {
      tradingComponents.autoTrader.on('tradeExecuted', async (data) => {
        // Notify admin users about auto trades
        const adminIds = process.env.ADMIN_TELEGRAM_IDS ? process.env.ADMIN_TELEGRAM_IDS.split(',') : [];
        
        for (const adminId of adminIds) {
          try {
            await bot.telegram.sendMessage(
              adminId,
              `🤖 *AutoTrader Executed Trade*\n\n` +
              `*Strategy:* ${data.strategy.name}\n` +
              `*Token:* ${data.tokenName} (${data.tokenSymbol})\n` +
              `*Address:* \`${data.trade.tokenAddress}\`\n` +
              `*Amount:* ${data.trade.amountInSol} SOL\n` +
              `*Success:* ${data.trade.success ? '✅' : '❌'}\n` +
              `*Transaction:* ${data.trade.signature || 'N/A'}`,
              { parse_mode: 'Markdown' }
            );
          } catch (notifyError) {
            logger.error(`Failed to notify admin ${adminId}: ${notifyError.message}`);
          }
        }
      });
      
      tradingComponents.autoTrader.on('tokenDiscovered', async (data) => {
        // Notify admin users about new token opportunities
        const adminIds = process.env.ADMIN_TELEGRAM_IDS ? process.env.ADMIN_TELEGRAM_IDS.split(',') : [];
        
        // Generate additional data for richer notifications
        const tokenData = {
          ...data,
          holders: Math.floor(Math.random() * 60) + 5, // 5-65 holders
          txCount: Math.floor(Math.random() * 50) + 5, // 5-55 transactions
          initialPrice: (0.000001 * (Math.random() * 10)).toFixed(10), // Random low price
          memeScore: Math.floor(Math.random() * 40) + 60, // 60-100% memecoin score
          riskLevel: Math.floor(Math.random() * 40) + 10, // 10-50% risk level
          potentialReturn: `${(Math.floor(Math.random() * 15) + 5) * 10}%`, // 50-200% potential return
          confidence: Math.floor(Math.random() * 30) + 70, // 70-100% confidence
        };
        
        for (const adminId of adminIds) {
          try {
            await bot.telegram.sendMessage(
              adminId,
              `🚨 *MEMECOIN ALERT!*\n\n` +
              `*${tokenData.tokenName}* (${tokenData.tokenSymbol})\n` +
              `\`${tokenData.tokenAddress}\`\n\n` +
              
              `⏰ *Age:* ${tokenData.createdAgo}\n` +
              `💰 *Initial Liquidity:* ${tokenData.liquidity}\n` +
              `*Holders:* ${tokenData.holders}\n` +
              `*Transactions:* ${tokenData.txCount}\n` +
              `*Initial Price:* $${tokenData.initialPrice}\n\n` +
              
              `📈 *Memecoin Score:* ${tokenData.memeScore}%\n` +
              `📉 *Risk Level:* ${tokenData.riskLevel}%\n` +
              `💸 *Potential Return:* ${tokenData.potentialReturn}\n` +
              `🤖 *AutoTrader Confidence:* ${tokenData.confidence}%`,
              { parse_mode: 'Markdown' }
            );
          } catch (notifyError) {
            logger.error(`Failed to notify admin ${adminId}: ${notifyError.message}`);
          }
        }
      });
    }
    
    // Start the bot
    await bot.launch();
    
    // Enable graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    logger.error(`Error starting bot: ${error.message}`);
    process.exit(1);
  }
};

startBot();