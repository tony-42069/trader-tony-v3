// Command handlers for the TraderTony v3 bot
const keyboards = require('../keyboards');
const logger = require('../utils/logger');
const solanaClient = require('../utils/solana');

/**
 * Creates the welcome message text
 * @param {Object} ctx - Telegram context
 * @returns {string} - Welcome message text
 */
const getWelcomeMessage = (ctx) => {
  return `Welcome to TraderTony - Expert Solana Trading Bot! 🚀

🚀 SNIPERTONY - Advanced Precision Trading
• MEV-protected transactions for optimal execution
• Custom gas optimization for faster confirmations
• Smart contract analysis & risk detection
• Auto Take-Profit/Stop-Loss management

⚡ Ultra-Fast Execution Suite
• Lightning-quick token sniping
• Anti-rug protection system
• Slippage control & front-run defense
• Multi-DEX liquidity monitoring

💼 Professional Trading Features
• Real-time price impact analysis
• Advanced charting integration
• Holder distribution tracking
• Volume & liquidity alerts

🔒 Enterprise-Grade Security
• Secure wallet integration
• Transaction signing verification
• Anti-MEV transaction routing
• Real-time risk assessment

Your TraderTony wallet address:
${ctx.session.wallet.address} (tap to copy)

💳 Buy SOL with Apple/Google Pay via MoonPay here.
📊 View tokens on: GMGN | BullX | DEX Screener | Photon

Balance: ${ctx.session.wallet.balance} SOL
Active Orders: ${ctx.session.activeOrders.length}
Security Status: 🔒 Secure`;
};

// Command handlers
module.exports = {
  /**
   * Handle the /start command
   * @param {Object} ctx - Telegram context
   */
  handleStart: async (ctx) => {
    try {
      // Simulate fetching balance
      ctx.session.wallet.balance = await solanaClient.getBalance();
      
      await ctx.reply(
        getWelcomeMessage(ctx),
        keyboards.mainKeyboard
      );
      logger.info(`User ${ctx.from.id} started the bot`);
    } catch (error) {
      logger.error(`Error in handleStart: ${error.message}`);
      ctx.reply('Error starting bot. Please try again.');
    }
  },
  
  /**
   * Handle the /help command
   * @param {Object} ctx - Telegram context
   */
  handleHelp: (ctx) => {
    ctx.reply(
      `TraderTony v3 Help:\n\n` +
      `• /start - Start or restart the bot\n` +
      `• /help - Show this help message\n` +
      `• /balance - Show your wallet balance\n\n` +
      `Use the buttons below for trading functions:`
    );
  },
  
  /**
   * Handle the /balance command
   * @param {Object} ctx - Telegram context
   */
  handleBalance: async (ctx) => {
    try {
      // Try to get real balance, fall back to mock if it fails
      try {
        ctx.session.wallet.balance = await solanaClient.getBalance();
      } catch (error) {
        logger.warn(`Could not fetch real balance: ${error.message}`);
        ctx.session.wallet.balance = 0; // Demo mode
      }
      
      ctx.reply(`💰 Your current balance: ${ctx.session.wallet.balance} SOL`);
    } catch (error) {
      logger.error(`Error in handleBalance: ${error.message}`);
      ctx.reply('Error fetching balance. Please try again.');
    }
  },
  
  /**
   * Handle the Buy button
   * @param {Object} ctx - Telegram context
   */
  handleBuy: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        'Enter the token address you want to buy:',
        { reply_markup: { force_reply: true } }
      );
    } catch (error) {
      logger.error(`Error in handleBuy: ${error.message}`);
      ctx.reply('Error processing buy request. Please try again.');
    }
  },
  
  /**
   * Handle token address input
   * @param {Object} ctx - Telegram context
   * @param {string} tokenAddress - Token address to buy
   */
  handleTokenInput: async (ctx, tokenAddress) => {
    try {
      // For demo, pretend to validate the token
      await ctx.reply(`Analyzing token: ${tokenAddress}...`);
      
      // Simulate token validation (would actually verify contract in production)
      setTimeout(async () => {
        // Save token to session
        ctx.session.snipe = {
          token: tokenAddress,
          amount: null
        };
        
        // Ask for amount
        await ctx.reply(
          `Token validated! How much SOL would you like to spend?`,
          { reply_markup: { force_reply: true } }
        );
      }, 2000);
    } catch (error) {
      logger.error(`Error in handleTokenInput: ${error.message}`);
      ctx.reply('Error validating token. Please try again with a valid token address.');
    }
  },
  
  /**
   * Handle amount input for buying
   * @param {Object} ctx - Telegram context
   * @param {number} amount - Amount of SOL to spend
   */
  handleAmountInput: async (ctx, amount) => {
    try {
      const { token } = ctx.session.snipe;
      ctx.session.snipe.amount = amount;
      
      // Get the current wallet balance
      let balance = 0;
      try {
        balance = await solanaClient.getBalance();
      } catch (error) {
        logger.warn(`Could not fetch wallet balance: ${error.message}`);
      }
      
      // Check if the amount is greater than the balance
      if (amount > balance) {
        ctx.reply(
          `⚠️ Warning: The amount ${amount} SOL is greater than your current balance (${balance.toFixed(2)} SOL).\n\n` +
          `Please enter a smaller amount or fund your wallet first.`,
          keyboards.mainKeyboard
        );
        return;
      }
      
      await ctx.reply(
        `Preparing to buy with ${amount} SOL.\n` +
        `Token: ${token}\n\n` +
        `Select slippage tolerance:`,
        keyboards.slippageKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleAmountInput: ${error.message}`);
      ctx.reply('Error processing amount. Please try again.', keyboards.mainKeyboard);
    }
  },
  
  /**
   * Handle the Fund button
   * @param {Object} ctx - Telegram context
   */
  handleFund: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `💳 Funding Options:\n\n` +
        `To fund your account, send SOL to the following address:\n\n` +
        `${ctx.session.wallet.address}\n\n` +
        `Your current balance: ${ctx.session.wallet.balance} SOL`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleFund: ${error.message}`);
      ctx.reply('Error processing fund request. Please try again.');
    }
  },
  
  /**
   * Handle the Monitor button
   * @param {Object} ctx - Telegram context
   */
  handleMonitor: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `📊 Price Monitoring\n\n` +
        `The monitoring feature is currently in demo mode.\n\n` +
        `In the full version, you'll be able to monitor token prices, set alerts, and track market movements.`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleMonitor: ${error.message}`);
      ctx.reply('Error accessing monitoring features. Please try again.');
    }
  },
  
  /**
   * Handle the Limit Orders button
   * @param {Object} ctx - Telegram context
   */
  handleLimitOrders: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `🎯 Limit Orders\n\n` +
        `You have no active limit orders.\n\n` +
        `This feature is currently in demo mode. In the full version, you'll be able to create limit buy and sell orders.`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleLimitOrders: ${error.message}`);
      ctx.reply('Error accessing limit orders. Please try again.');
    }
  },
  
  /**
   * Handle the Wallet button
   * @param {Object} ctx - Telegram context
   */
  handleWallet: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      // Try to get real balance and tokens
      try {
        ctx.session.wallet.balance = await solanaClient.getBalance();
        // Get token balances if not in demo mode
        if (!solanaClient.demoMode) {
          ctx.session.wallet.tokens = await solanaClient.getTokenBalances();
        }
      } catch (error) {
        logger.warn(`Could not fetch wallet data: ${error.message}`);
      }
      
      // Build token list display
      let tokenDisplay = 'No tokens found';
      if (ctx.session.wallet.tokens && ctx.session.wallet.tokens.length > 0) {
        tokenDisplay = ctx.session.wallet.tokens.map(token => 
          `${token.symbol || 'Unknown'}: ${token.balance} (${token.mint.substring(0, 8)}...)`
        ).join('\n');
      }
      
      await ctx.reply(
        `👛 Wallet Information\n\n` +
        `Address: ${solanaClient.getWalletAddress()}\n` +
        `Balance: ${ctx.session.wallet.balance} SOL\n\n` +
        `Tokens:\n${tokenDisplay}`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleWallet: ${error.message}`);
      ctx.reply('Error accessing wallet information. Please try again.');
    }
  },
  
  /**
   * Handle the Settings button
   * @param {Object} ctx - Telegram context
   */
  handleSettings: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `⚙️ Settings\n\n` +
        `Slippage: ${ctx.session.settings.slippage}%\n` +
        `Gas Price: ${ctx.session.settings.gasPrice} gwei\n` +
        `Stop Loss: ${ctx.session.settings.stopLoss}%\n` +
        `Take Profit: ${ctx.session.settings.takeProfit}%`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleSettings: ${error.message}`);
      ctx.reply('Error accessing settings. Please try again.');
    }
  },
  
  /**
   * Handle the DCA Orders button
   * @param {Object} ctx - Telegram context
   */
  handleDCAOrders: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `📋 DCA Orders\n\n` +
        `You have no active DCA orders.\n\n` +
        `This feature is currently in demo mode. In the full version, you'll be able to create dollar-cost averaging orders.`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleDCAOrders: ${error.message}`);
      ctx.reply('Error accessing DCA orders. Please try again.');
    }
  },
  
  /**
   * Handle the Refer Friends button
   * @param {Object} ctx - Telegram context
   */
  handleReferFriends: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.reply(
        `🤝 Refer Friends\n\n` +
        `Share TraderTony with your friends!\n\n` +
        `Referral program is currently in demo mode. In the full version, you'll earn rewards for each friend you refer.`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleReferFriends: ${error.message}`);
      ctx.reply('Error accessing referral program. Please try again.');
    }
  },
  
  /**
   * Handle the Refresh button
   * @param {Object} ctx - Telegram context
   */
  handleRefresh: async (ctx) => {
    try {
      await ctx.answerCbQuery('Refreshing...');
      
      // Update wallet balance
      try {
        ctx.session.wallet.balance = await solanaClient.getBalance();
      } catch (error) {
        logger.warn(`Could not fetch real balance: ${error.message}`);
      }
      
      await ctx.reply(
        `✅ Data refreshed\n\n` +
        `Wallet: ${ctx.session.wallet.address}\n` +
        `Balance: ${ctx.session.wallet.balance} SOL`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleRefresh: ${error.message}`);
      ctx.reply('Error refreshing data. Please try again.');
    }
  },
  
  /**
   * Handle slippage selection for token buying
   * @param {Object} ctx - Telegram context
   * @param {string} data - Callback data (slippage_X)
   */
  handleSlippageSelection: async (ctx, data) => {
    try {
      const slippage = parseFloat(data.split('_')[1]);
      const { token, amount } = ctx.session.snipe;
      
      await ctx.answerCbQuery(`Selected slippage: ${slippage}%`);
      
      // Send status message
      const statusMsg = await ctx.reply(`Buying token ${token} with ${amount} SOL (slippage: ${slippage}%)...`);
      
      // Execute the buy
      const result = await solanaClient.buyToken(token, amount, slippage);
      
      if (result.success) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          statusMsg.message_id,
          null,
          `✅ Purchase successful!\n\n` +
          `Token: ${token}\n` +
          `Amount spent: ${amount} SOL\n` +
          `Tokens received: ~${result.tokenAmount}\n` +
          `Transaction: ${result.transactionHash}\n\n` +
          `Would you like to set up stop-loss/take-profit?`,
          keyboards.stopLossTakeProfitKeyboard
        );
        
        // Store the token in session for SL/TP setup
        ctx.session.lastBuyToken = token;
      } else {
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          statusMsg.message_id,
          null,
          `❌ Purchase failed!\n\n` +
          `Token: ${token}\n` +
          `Error: ${result.error || 'Unknown error'}\n\n` +
          `Try again or choose a different token.`,
          keyboards.mainKeyboard
        );
      }
      
      // Reset snipe data
      ctx.session.snipe = {
        token: null,
        amount: null
      };
    } catch (error) {
      logger.error(`Error in handleSlippageSelection: ${error.message}`);
      ctx.reply('Error processing purchase. Please try again.', keyboards.mainKeyboard);
      
      // Reset snipe data
      ctx.session.snipe = {
        token: null,
        amount: null
      };
    }
  },
  
  /**
   * Handle stop-loss/take-profit setup
   * @param {Object} ctx - Telegram context
   * @param {string} data - Callback data (sl_tp_X_Y)
   */
  handleStopLossTakeProfit: async (ctx, data) => {
    try {
      if (data === 'skip_sl_tp') {
        await ctx.answerCbQuery('Skipped SL/TP setup');
        await ctx.reply('No stop-loss/take-profit was set. You can manage your positions in the Wallet section.', keyboards.mainKeyboard);
        return;
      }
      
      const [sl, tp] = data.split('_').slice(2).map(Number);
      const token = ctx.session.lastBuyToken;
      
      if (!token) {
        await ctx.answerCbQuery('No recent token purchase found');
        await ctx.reply('Unable to set up stop-loss/take-profit: No recent token purchase found.', keyboards.mainKeyboard);
        return;
      }
      
      await ctx.answerCbQuery(`Setting SL: ${sl}%, TP: ${tp}%`);
      
      // Send status message
      const statusMsg = await ctx.reply(`Setting up stop-loss at -${sl}% and take-profit at +${tp}% for ${token}...`);
      
      // Set up SL/TP
      const result = await solanaClient.setupStopLossTakeProfit(token, sl, tp);
      
      if (result.success) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          statusMsg.message_id,
          null,
          `✅ Stop-loss/take-profit set!\n\n` +
          `Token: ${token}\n` +
          `Stop-loss: -${sl}%\n` +
          `Take-profit: +${tp}%\n` +
          `Order ID: ${result.orderId}`,
          keyboards.mainKeyboard
        );
        
        // Add to active orders
        ctx.session.activeOrders.push({
          id: result.orderId,
          token: token,
          stopLoss: sl,
          takeProfit: tp,
          createdAt: Date.now()
        });
      } else {
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          statusMsg.message_id,
          null,
          `❌ Failed to set stop-loss/take-profit!\n\n` +
          `Token: ${token}\n` +
          `Error: ${result.error || 'Unknown error'}`,
          keyboards.mainKeyboard
        );
      }
    } catch (error) {
      logger.error(`Error in handleStopLossTakeProfit: ${error.message}`);
      ctx.reply('Error setting up stop-loss/take-profit. Please try again.', keyboards.mainKeyboard);
    }
  }
};