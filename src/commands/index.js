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

/**
 * Handle /positions command
 * @param {Object} ctx - Telegram context
 */
const handlePositions = async (ctx) => {
  try {
    // Get all open positions
    const openPositions = solanaClient.getOpenPositions();
    
    if (openPositions.length === 0) {
      return ctx.reply('📊 *You have no open positions*\n\nUse /snipe or /buy to purchase tokens.', {
        parse_mode: 'Markdown'
      });
    }
    
    // Format positions for display
    const positionsText = await formatPositions(openPositions);
    
    return ctx.reply(positionsText, {
      parse_mode: 'Markdown',
      disable_web_preview: true
    });
  } catch (error) {
    logger.error(`Error in handlePositions: ${error.message}`);
    return ctx.reply('❌ Error retrieving positions. Please try again later.');
  }
};

/**
 * Format positions for display
 * @param {Array} positions - Array of positions
 * @returns {Promise<string>} Formatted positions text
 */
const formatPositions = async (positions) => {
  try {
    let message = '📊 *Your Open Positions*\n\n';
    
    // Sort positions by creation date (newest first)
    const sortedPositions = [...positions].sort((a, b) => b.createdAt - a.createdAt);
    
    for (const position of sortedPositions) {
      // Get current price for P/L calculation
      let currentPrice;
      try {
        currentPrice = await solanaClient.positionManager.getTokenPrice(position.tokenAddress);
      } catch (error) {
        currentPrice = position.entryPrice; // Use entry price if cannot get current price
      }
      
      // Calculate profit/loss percentage
      const plPercentage = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const plEmoji = plPercentage >= 0 ? '🟢' : '🔴';
      
      // Format token address for display
      const shortAddress = `${position.tokenAddress.substring(0, 4)}...${position.tokenAddress.substring(position.tokenAddress.length - 4)}`;
      
      // Format token symbol (if available)
      let tokenSymbol = 'Unknown';
      try {
        const tokenInfo = await solanaClient.getTokenInfo(position.tokenAddress);
        tokenSymbol = tokenInfo.symbol || 'Unknown';
      } catch (error) {
        // Use Unknown as fallback
      }
      
      // Format position details
      message += `*Token:* ${tokenSymbol} (${shortAddress})\n`;
      message += `*Amount:* ${position.amount.toFixed(4)}\n`;
      message += `*Entry Price:* ${position.entryPrice.toFixed(6)} SOL\n`;
      message += `*Current Price:* ${currentPrice.toFixed(6)} SOL\n`;
      message += `*P/L:* ${plEmoji} ${plPercentage.toFixed(2)}%\n`;
      
      // Add risk management settings if set
      const riskSettings = [];
      if (position.stopLoss) riskSettings.push(`SL: -${position.stopLoss}%`);
      if (position.takeProfit) riskSettings.push(`TP: +${position.takeProfit}%`);
      if (position.trailingStop) riskSettings.push(`TS: ${position.trailingStop}%`);
      
      if (riskSettings.length > 0) {
        message += `*Risk Management:* ${riskSettings.join(' | ')}\n`;
      }
      
      // Add when the position was opened
      const openDate = new Date(position.createdAt).toLocaleString();
      message += `*Opened:* ${openDate}\n\n`;
    }
    
    // Add footer with explanation
    message += `_Use /snipe [token] to add more positions_`;
    
    return message;
  } catch (error) {
    logger.error(`Error formatting positions: ${error.message}`);
    return '❌ Error formatting positions. Please try again later.';
  }
};

/**
 * Updates all monitored tokens and notifies users of significant changes
 * @param {Object} bot - Telegram bot instance
 */
async function updateMonitoredTokens(bot) {
  try {
    // Get all active sessions
    const sessions = Object.entries(bot.context.session || {});
    for (const [userId, session] of sessions) {
      if (!session || !session.monitoring) continue;
      
      // For each monitored token in the session
      for (const [tokenAddress, tokenData] of Object.entries(session.monitoring)) {
        try {
          // Get current price from Jupiter
          let currentPrice = -1;
          if (solanaClient.jupiterClient) {
            currentPrice = await solanaClient.jupiterClient.getTokenPrice(tokenAddress);
          }
          
          // If we couldn't get a price, skip this update
          if (currentPrice <= 0) continue;
          
          // Calculate price change percentage
          const previousPrice = tokenData.lastPrice || tokenData.initialPrice;
          const changePercent = previousPrice > 0 
            ? ((currentPrice - previousPrice) / previousPrice) * 100 
            : 0;
          
          // Update session data
          tokenData.lastPrice = currentPrice;
          tokenData.lastChecked = new Date();
          
          // Check for significant price change (>5%)
          const significantChange = Math.abs(changePercent) >= 5;
          
          // Check for triggered alerts
          const triggeredAlerts = [];
          if (tokenData.alerts && tokenData.alerts.length > 0) {
            tokenData.alerts.forEach(alert => {
              if (alert.triggered) return;
              
              // Check if alert conditions are met
              const isTriggered = 
                (alert.condition === '>' && currentPrice > alert.threshold) ||
                (alert.condition === '<' && currentPrice < alert.threshold);
              
              if (isTriggered) {
                alert.triggered = true;
                alert.triggeredAt = new Date();
                triggeredAlerts.push(alert);
              }
            });
          }
          
          // Only send a message if there's a significant change or triggered alert
          if (significantChange || triggeredAlerts.length > 0) {
            let message = `📊 *Token Update*\n\n`;
            message += `Token: \`${tokenAddress}\`\n`;
            message += `Current Price: ${currentPrice.toFixed(8)} SOL\n`;
            
            if (significantChange) {
              const changeIcon = changePercent > 0 ? '📈' : '📉';
              message += `${changeIcon} *${Math.abs(changePercent).toFixed(2)}%* ${changePercent > 0 ? 'increase' : 'decrease'} in the last hour\n`;
            }
            
            // Add alert notifications
            if (triggeredAlerts.length > 0) {
              message += `\n⚠️ *Alerts Triggered:*\n`;
              triggeredAlerts.forEach(alert => {
                message += `• Price ${alert.condition === '>' ? 'above' : 'below'} ${alert.threshold.toFixed(8)} SOL\n`;
              });
            }
            
            // Add chart button
            const keyboard = {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '📈 Chart', url: `https://dexscreener.com/solana/${tokenAddress}` },
                    { text: '❌ Stop Monitoring', callback_data: `stop_monitor_${tokenAddress}` }
                  ]
                ]
              }
            };
            
            // Send message to user
            await bot.telegram.sendMessage(userId, message, {
              parse_mode: 'Markdown',
              ...keyboard
            });
          }
        } catch (error) {
          logger.error(`Error updating monitored token ${tokenAddress}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logger.error(`Error in updateMonitoredTokens: ${error.message}`);
  }
}

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
      `• /balance - Show your wallet balance\n` +
      `• /snipe - Snipe a token\n` +
      `• /buy - Enter a token to buy\n` +
      `• /fund - View wallet funding options\n` +
      `• /wallet - View wallet information\n` +
      `• /refresh - Update wallet balance\n\n` +
      `Use the buttons below for additional trading functions:`
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
   * Handle the Buy button or /buy command
   * @param {Object} ctx - Telegram context
   */
  handleBuy: async (ctx) => {
    try {
      // Check if this is a callback query (button click) and answer it
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
      }
      
      // If there's a parameter with the command (like /buy ADDRESS)
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/buy')) {
        const parts = ctx.message.text.split(' ');
        if (parts.length > 1) {
          // Address provided with command, handle it directly
          return exports.handleTokenInput(ctx, parts[1]);
        }
      }
      
      // Otherwise just ask for the token address
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
      // Send initial message
      await ctx.reply(`Analyzing token: ${tokenAddress}...`);
      
      // Validate and analyze the token
      const riskAnalysis = await solanaClient.analyzeTokenRisk(tokenAddress);
      
      // Save token to session regardless of risk level
      ctx.session.snipe = {
        token: tokenAddress,
        amount: null,
        riskAnalysis: riskAnalysis
      };
      
      let message = '';
      
      // Format risk level message based on risk
      if (riskAnalysis.riskLevel <= 30) {
        message = `✅ Low Risk Token (${riskAnalysis.riskLevel}%)\n`;
      } else if (riskAnalysis.riskLevel <= 60) {
        message = `⚠️ Medium Risk Token (${riskAnalysis.riskLevel}%)\n`;
      } else {
        message = `🚨 HIGH RISK TOKEN (${riskAnalysis.riskLevel}%)\n`;
      }
      
      // Add warnings if any
      if (riskAnalysis.warnings && riskAnalysis.warnings.length > 0) {
        message += `\nWarnings:\n• ${riskAnalysis.warnings.join('\n• ')}\n`;
      }
      
      // Add additional info
      message += `\nToken: ${tokenAddress}\n\n`;
      message += `How much SOL would you like to spend?`;
      
      // Ask for amount
      await ctx.reply(message, { reply_markup: { force_reply: true } });
    } catch (error) {
      logger.error(`Error in handleTokenInput: ${error.message}`);
      ctx.reply('Error validating token. Please try again with a valid token address.', keyboards.mainKeyboard);
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
        `💳 *Funding Options:*\n\n` +
        `To fund your account, send SOL to the following address:\n\n` +
        `\`${ctx.session.wallet.address}\`\n\n` +
        `Your current balance: ${ctx.session.wallet.balance} SOL\n\n` +
        `Use the Phantom Wallet options below for easy deposits and withdrawals.`,
        {
          parse_mode: 'Markdown',
          ...keyboards.fundKeyboard
        }
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
      
      // Check if we have real monitoring capabilities
      if (!solanaClient.readOnlyMode && solanaClient.demoMode) {
        // Full demo mode with sample wallet
        await ctx.reply(
          `📊 Price Monitoring\n\n` +
          `The monitoring feature is currently in demo mode.\n\n` +
          `In the full version, you'll be able to monitor token prices, set alerts, and track market movements.`,
          keyboards.mainKeyboard
        );
      } else {
        // Real wallet in read-only mode or with private key
        await ctx.reply(
          `📊 *Price Monitoring*\n\n` +
          `Enter a token address to start monitoring its price:\n\n` +
          `Example: 9Cp3TginebPRG2zNK9Nz3MEKoGhgt6SM2VdGkubJpump`,
          { 
            parse_mode: 'Markdown',
            ...keyboards.backToMainKeyboard 
          }
        );
        
        // Set user state to wait for token address
        ctx.session.state = 'WAITING_FOR_MONITOR_TOKEN';
      }
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
      
      // Initialize if not already done
      if (!ctx.session.limitOrders) {
        ctx.session.limitOrders = [];
      }
      
      if (ctx.session.limitOrders.length === 0) {
        await ctx.reply(
          `🎯 Limit Orders\n\n` +
          `You have no active limit orders.\n\n` +
          `To create a limit order, use the buttons below:`,
          keyboards.limitOrderKeyboard
        );
      } else {
        // Format the limit orders list
        const ordersList = ctx.session.limitOrders.map((order, index) => {
          return `${index + 1}. ${order.type.toUpperCase()} ${order.amount} SOL of ${order.tokenAddress.slice(0, 8)}... at ${order.price} SOL`;
        }).join('\n');
        
        await ctx.reply(
          `🎯 Your Limit Orders\n\n` +
          ordersList + `\n\n` +
          `To create a new limit order, use the buttons below:`,
          keyboards.limitOrderKeyboard
        );
      }
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
      
      // Initialize if not already done
      if (!ctx.session.dcaOrders) {
        ctx.session.dcaOrders = [];
      }
      
      if (ctx.session.dcaOrders.length === 0) {
        await ctx.reply(
          `📋 DCA Orders\n\n` +
          `You have no active DCA orders.\n\n` +
          `To create a dollar-cost averaging order, use the button below:`,
          keyboards.dcaOrderKeyboard
        );
      } else {
        // Format the DCA orders list
        const ordersList = ctx.session.dcaOrders.map((order, index) => {
          return `${index + 1}. Buy ${order.amount} SOL of ${order.tokenAddress.slice(0, 8)}... every ${order.interval} hours`;
        }).join('\n');
        
        await ctx.reply(
          `📋 Your DCA Orders\n\n` +
          ordersList + `\n\n` +
          `To create a new DCA order, use the button below:`,
          keyboards.dcaOrderKeyboard
        );
      }
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
      
      // If risk level is high (>70), use the handleTokenSnipe function instead
      // which will show additional warnings
      if (ctx.session.snipe.riskAnalysis && ctx.session.snipe.riskAnalysis.riskLevel > 70) {
        return await exports.handleTokenSnipe(ctx, token, amount, slippage);
      }
      
      // Send status message
      const statusMsg = await ctx.reply(`Buying token ${token} with ${amount} SOL (slippage: ${slippage}%)...`);
      
      // Execute the snipe instead of regular buy
      const result = await solanaClient.snipeToken(token, amount, {
        slippage,
        stopLoss: ctx.session.settings.stopLoss,
        takeProfit: ctx.session.settings.takeProfit
      });
      
      if (result.success) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          statusMsg.message_id,
          null,
          `✅ Purchase successful!\n\n` +
          `Token: ${token}\n` +
          `Amount spent: ${amount} SOL\n` +
          `Tokens received: ~${result.tokenAmount}\n` +
          `Transaction: ${result.signature}\n\n` +
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
        amount: null,
        riskAnalysis: null
      };
    } catch (error) {
      logger.error(`Error in handleSlippageSelection: ${error.message}`);
      ctx.reply('Error processing purchase. Please try again.', keyboards.mainKeyboard);
      
      // Reset snipe data
      ctx.session.snipe = {
        token: null,
        amount: null,
        riskAnalysis: null
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
  },
  
  /**
   * Handle token sniping
   * @param {Object} ctx - Telegram context
   * @param {string} tokenAddress - Token address to snipe
   * @param {number} amount - Amount of SOL to spend
   * @param {number} slippage - Slippage percentage
   */
  handleTokenSnipe: async (ctx, tokenAddress, amount, slippage) => {
    try {
      // Send initial status message
      const statusMsg = await ctx.reply(
        `🔍 Analyzing token ${tokenAddress}...\n` +
        `This may take a few moments.`
      );
      
      // Analyze token risk
      const riskAnalysis = await solanaClient.analyzeTokenRisk(tokenAddress);
      
      // If risk analysis failed or risk is too high, warn the user
      if (!riskAnalysis.success || riskAnalysis.riskLevel > 70) {
        const warnings = riskAnalysis.warnings ? riskAnalysis.warnings.join('\n• ') : 'Unknown risk';
        
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `⚠️ High Risk Token Detected!\n\n` +
          `Risk Level: ${riskAnalysis.riskLevel}%\n\n` +
          `Warnings:\n• ${warnings}\n\n` +
          `Do you still want to proceed with the purchase?`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Yes, buy anyway', callback_data: `force_buy_${tokenAddress}_${amount}_${slippage}` },
                  { text: '❌ No, cancel', callback_data: 'cancel_snipe' }
                ]
              ]
            }
          }
        );
        return;
      }
      
      // Update status message with risk analysis
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `✅ Token Analysis Complete\n\n` +
        `Risk Level: ${riskAnalysis.riskLevel}%\n\n` +
        `Proceeding with purchase...\n` +
        `• Token: ${tokenAddress}\n` +
        `• Amount: ${amount} SOL\n` +
        `• Slippage: ${slippage}%`
      );
      
      // Execute the snipe
      const snipeResult = await solanaClient.snipeToken(tokenAddress, amount, {
        slippage,
        stopLoss: ctx.session.settings.stopLoss,
        takeProfit: ctx.session.settings.takeProfit
      });
      
      if (snipeResult.success) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `✅ Token Sniped Successfully!\n\n` +
          `• Token: ${tokenAddress}\n` +
          `• Amount Spent: ${amount} SOL\n` +
          `• Tokens Received: ~${snipeResult.tokenAmount}\n` +
          `• Transaction: ${snipeResult.signature}\n\n` +
          `Would you like to set up stop-loss/take-profit?`,
          keyboards.stopLossTakeProfitKeyboard
        );
        
        // Store the token in session for SL/TP setup
        ctx.session.lastBuyToken = tokenAddress;
      } else {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `❌ Sniping Failed!\n\n` +
          `• Token: ${tokenAddress}\n` +
          `• Error: ${snipeResult.error || 'Unknown error'}\n\n` +
          `Please try again or choose a different token.`,
          keyboards.mainKeyboard
        );
      }
    } catch (error) {
      logger.error(`Error in handleTokenSnipe: ${error.message}`);
      ctx.reply('Error sniping token. Please try again.', keyboards.mainKeyboard);
    }
  },
  
  /**
   * Handle force buy callback
   * @param {Object} ctx - Telegram context
   * @param {string} data - Callback data in format force_buy_TOKEN_AMOUNT_SLIPPAGE
   */
  handleForceBuy: async (ctx, data) => {
    try {
      const parts = data.split('_');
      const tokenAddress = parts[2];
      const amount = parseFloat(parts[3]);
      const slippage = parseFloat(parts[4]);
      
      await ctx.answerCbQuery('Proceeding with purchase despite high risk');
      
      // Proceed with snipe
      await exports.handleTokenSnipe(ctx, tokenAddress, amount, slippage);
    } catch (error) {
      logger.error(`Error in handleForceBuy: ${error.message}`);
      ctx.reply('Error processing purchase. Please try again.', keyboards.mainKeyboard);
    }
  },
  
  /**
   * Handle cancel snipe callback
   * @param {Object} ctx - Telegram context
   */
  handleCancelSnipe: async (ctx) => {
    try {
      await ctx.answerCbQuery('Purchase cancelled');
      await ctx.reply('Purchase cancelled. Your funds are safe.', keyboards.mainKeyboard);
    } catch (error) {
      logger.error(`Error in handleCancelSnipe: ${error.message}`);
      ctx.reply('Error cancelling purchase. Please try again.', keyboards.mainKeyboard);
    }
  },
  
  /**
   * Handle the /snipe command
   * @param {Object} ctx - Telegram context
   */
  handleSnipe: async (ctx) => {
    try {
      // Check if this is a callback from a button click
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
        
        // Display the snipe instructions directly for button clicks
        await ctx.reply(
          `📝 Token Sniping\n\n` +
          `To snipe a token, use one of these formats:\n\n` +
          `1. /snipe [token_address]\n` +
          `2. /snipe [token_address] [amount_in_sol]\n` +
          `3. /snipe [token_address] [amount_in_sol] [slippage]\n\n` +
          `Example: /snipe EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 0.1 1\n\n` +
          `Or just enter a token address below:`,
          { reply_markup: { force_reply: true } }
        );
        return;
      }
      
      // Command message handling
      if (!ctx.message || !ctx.message.text) {
        // Fallback for situations where message is not available
        await ctx.reply(
          `📝 Token Sniping\n\n` +
          `To snipe a token, enter a token address below:`,
          { reply_markup: { force_reply: true } }
        );
        return;
      }
      
      // Get command arguments if any
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length === 0) {
        // No arguments, provide instructions
        await ctx.reply(
          `📝 Token Sniping\n\n` +
          `To snipe a token, use one of these formats:\n\n` +
          `1. /snipe [token_address]\n` +
          `2. /snipe [token_address] [amount_in_sol]\n` +
          `3. /snipe [token_address] [amount_in_sol] [slippage]\n\n` +
          `Example: /snipe EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 0.1 1\n\n` +
          `Or just enter a token address below:`,
          { reply_markup: { force_reply: true } }
        );
        return;
      }
      
      // Token address is the first argument
      const tokenAddress = args[0];
      
      if (args.length === 1) {
        // Only token address provided, handle like regular token input
        return await exports.handleTokenInput(ctx, tokenAddress);
      }
      
      // Amount is the second argument if provided
      const amount = parseFloat(args[1]);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Invalid amount. Please enter a positive number.');
        return;
      }
      
      // Slippage is the third argument if provided, otherwise use default
      const slippage = args.length > 2 ? parseFloat(args[2]) : ctx.session.settings.slippage;
      if (isNaN(slippage) || slippage <= 0) {
        await ctx.reply('Invalid slippage. Please enter a positive number.');
        return;
      }
      
      // Set up snipe data in session
      ctx.session.snipe = {
        token: tokenAddress,
        amount: amount
      };
      
      // Run token analysis and proceed with snipe
      await exports.handleTokenSnipe(ctx, tokenAddress, amount, slippage);
    } catch (error) {
      logger.error(`Error in handleSnipe: ${error.message}`);
      ctx.reply('Error processing snipe command. Please try again.', keyboards.mainKeyboard);
    }
  },
  handlePositions,
  
  /**
   * Handle token address input for monitoring
   * @param {Object} ctx - Telegram context
   * @param {string} tokenAddress - Token address to monitor
   */
  handleMonitorTokenInput: async (ctx, tokenAddress) => {
    try {
      // Send initial message
      await ctx.reply(`Analyzing token for monitoring: ${tokenAddress}...`);
      
      // Validate the token
      const riskAnalysis = await solanaClient.analyzeTokenRisk(tokenAddress);
      
      // Get initial price information
      let tokenInfo;
      try {
        // First get standard token info
        tokenInfo = await solanaClient.getTokenInfo(tokenAddress);
        
        // Then try to get price from Jupiter
        if (solanaClient.jupiterClient) {
          const price = await solanaClient.jupiterClient.getTokenPrice(tokenAddress);
          if (price > 0) {
            tokenInfo.price = price;
          }
        }
      } catch (error) {
        logger.error(`Error getting token info: ${error.message}`);
        tokenInfo = { 
          address: tokenAddress,
          symbol: 'UNKNOWN', 
          name: 'Unknown Token', 
          decimals: 9,
          price: 0 
        };
      }
      
      // Create monitoring entry in session
      if (!ctx.session.monitoring) {
        ctx.session.monitoring = {};
      }
      
      // Store in session
      ctx.session.monitoring[tokenAddress] = {
        tokenAddress,
        initialPrice: tokenInfo.price || 0,
        lastPrice: tokenInfo.price || 0,
        lastChecked: new Date(),
        alerts: []
      };
      
      // Display token information
      let message = `📊 *Token Monitoring Started*\n\n`;
      message += `Token: \`${tokenAddress}\`\n`;
      
      if (tokenInfo.name && tokenInfo.name !== tokenAddress) {
        message += `Name: ${tokenInfo.name}\n`;
      }
      
      if (tokenInfo.symbol && tokenInfo.symbol !== 'UNKNOWN') {
        message += `Symbol: ${tokenInfo.symbol}\n`;
      } else {
        message += `Symbol: Unknown\n`;
      }
      
      if (tokenInfo.price && tokenInfo.price > 0) {
        message += `Current Price: ${tokenInfo.price.toFixed(8)} SOL\n`;
      } else {
        message += `Current Price: Unable to determine\n`;
      }
      
      message += `\nRisk Level: ${riskAnalysis.riskLevel}%\n`;
      
      // Add warnings if any
      if (riskAnalysis.warnings && riskAnalysis.warnings.length > 0) {
        message += `\nWarnings:\n• ${riskAnalysis.warnings.join('\n• ')}\n`;
      }
      
      message += `\nUse the buttons below to set alerts or stop monitoring:`;
      
      const monitoringKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⏰ Set Price Alert', callback_data: `alert_${tokenAddress}` },
              { text: '📈 Chart', url: `https://dexscreener.com/solana/${tokenAddress}` }
            ],
            [
              { text: '❌ Stop Monitoring', callback_data: `stop_monitor_${tokenAddress}` },
              { text: '« Back', callback_data: 'refresh' }
            ]
          ]
        },
        parse_mode: 'Markdown'
      };
      
      await ctx.reply(message, monitoringKeyboard);
    } catch (error) {
      logger.error(`Error in handleMonitorTokenInput: ${error.message}`);
      ctx.reply('Error monitoring token. Please try again with a valid token address.', keyboards.mainKeyboard);
    }
  },
  
  /**
   * Handle setting a price alert for a monitored token
   * @param {Object} ctx - Telegram context
   * @param {string} tokenAddress - Token address to set alert for
   */
  handleSetAlert: async (ctx, tokenAddress) => {
    try {
      await ctx.answerCbQuery();
      
      // Check if token is being monitored
      if (!ctx.session.monitoring || !ctx.session.monitoring[tokenAddress]) {
        return ctx.reply('This token is not being monitored. Please start monitoring it first.');
      }
      
      await ctx.reply(
        `⏰ *Set Price Alert*\n\n` +
        `Please enter the price threshold in SOL for ${tokenAddress.slice(0, 8)}...:\n\n` +
        `Current price: ${ctx.session.monitoring[tokenAddress].lastPrice.toFixed(8)} SOL\n\n` +
        `Format: [> or <][price]\n` +
        `Examples:\n` +
        `> 0.001 (Alert when price goes above 0.001 SOL)\n` +
        `< 0.0005 (Alert when price goes below 0.0005 SOL)`,
        { parse_mode: 'Markdown' }
      );
      
      // Set state to waiting for alert threshold
      ctx.session.state = 'WAITING_FOR_ALERT_THRESHOLD';
      ctx.session.alertSetup = {
        tokenAddress
      };
    } catch (error) {
      logger.error(`Error in handleSetAlert: ${error.message}`);
      ctx.reply('Error setting alert. Please try again.');
    }
  },
  
  /**
   * Handle stopping monitoring for a token
   * @param {Object} ctx - Telegram context
   * @param {string} tokenAddress - Token address to stop monitoring
   */
  handleStopMonitoring: async (ctx, tokenAddress) => {
    try {
      await ctx.answerCbQuery();
      
      // Check if token is being monitored
      if (!ctx.session.monitoring || !ctx.session.monitoring[tokenAddress]) {
        return ctx.reply('This token is not being monitored.');
      }
      
      // Remove from monitoring
      delete ctx.session.monitoring[tokenAddress];
      
      await ctx.reply(
        `✅ Stopped monitoring ${tokenAddress.slice(0, 8)}...`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleStopMonitoring: ${error.message}`);
      ctx.reply('Error stopping monitoring. Please try again.');
    }
  },
  
  /**
   * Handle alert threshold input
   * @param {Object} ctx - Telegram context
   * @param {string} tokenAddress - Token address to set alert for
   * @param {string} thresholdInput - User input for alert threshold
   */
  handleAlertThresholdInput: async (ctx, tokenAddress, thresholdInput) => {
    try {
      // Check if token is being monitored
      if (!ctx.session.monitoring || !ctx.session.monitoring[tokenAddress]) {
        return ctx.reply('This token is not being monitored. Please start monitoring it first.');
      }
      
      // Parse the threshold input
      // Format should be "> price" or "< price"
      const match = thresholdInput.trim().match(/^([<>])\s*([0-9.]+)$/);
      if (!match) {
        return ctx.reply(
          '❌ Invalid format. Please use:\n\n' +
          '`> price` for price increases\n' +
          '`< price` for price decreases\n\n' +
          'Example: `> 0.001` (Alert when price goes above 0.001 SOL)',
          { parse_mode: 'Markdown' }
        );
      }
      
      const direction = match[1];
      const threshold = parseFloat(match[2]);
      
      // Create the alert
      const alert = {
        id: Date.now().toString(),
        direction,
        threshold,
        createdAt: Date.now()
      };
      
      // Add to the monitored token's alerts
      if (!ctx.session.monitoring[tokenAddress].alerts) {
        ctx.session.monitoring[tokenAddress].alerts = [];
      }
      
      ctx.session.monitoring[tokenAddress].alerts.push(alert);
      
      // Get current price for reference
      const currentPrice = ctx.session.monitoring[tokenAddress].lastPrice || 'unknown';
      
      await ctx.reply(
        `✅ Alert set successfully!\n\n` +
        `You will be notified when the price of ${tokenAddress.slice(0, 8)}... goes ` +
        `${direction === '>' ? 'above' : 'below'} ${threshold} SOL.\n\n` +
        `Current price: ${currentPrice} SOL`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleAlertThresholdInput: ${error.message}`);
      ctx.reply('Error setting alert threshold. Please try again.');
    }
  },
  
  /**
   * Handle the Create Limit Buy button
   * @param {Object} ctx - Telegram context
   */
  handleCreateLimitBuy: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      // Check if we can execute real transactions
      if (solanaClient.demoMode || solanaClient.readOnlyMode) {
        return ctx.reply(
          `ℹ️ Limit Orders\n\n` +
          `This feature requires a wallet with a private key to execute transactions.\n\n` +
          `Currently the bot is in ${solanaClient.demoMode ? 'demo mode' : 'read-only mode'}. ` +
          `To enable real trading, please update your .env file with your PRIVATE_KEY.`,
          keyboards.backToMainKeyboard
        );
      }
      
      // Ask for token address
      await ctx.reply(
        `🎯 Create Limit Buy Order\n\n` +
        `Enter the token address you want to buy:`,
        { reply_markup: { force_reply: true } }
      );
      
      // Set state to wait for token address
      ctx.session.state = 'WAITING_FOR_LIMIT_BUY_TOKEN';
    } catch (error) {
      logger.error(`Error in handleCreateLimitBuy: ${error.message}`);
      ctx.reply('Error creating limit buy. Please try again.');
    }
  },
  
  /**
   * Handle limit buy token input
   * @param {Object} ctx - Telegram context 
   * @param {string} tokenAddress - Token address
   */
  handleLimitBuyTokenInput: async (ctx, tokenAddress) => {
    try {
      await ctx.reply(`Analyzing token: ${tokenAddress}...`);
      
      // Analyze token risk
      const riskAnalysis = await solanaClient.analyzeTokenRisk(tokenAddress);
      
      // Format risk level message
      let riskLevelEmoji = '✅';
      let riskDescription = 'Low';
      
      if (riskAnalysis.riskLevel > 70) {
        riskLevelEmoji = '🔴';
        riskDescription = 'High';
      } else if (riskAnalysis.riskLevel > 30) {
        riskLevelEmoji = '🟠';
        riskDescription = 'Medium';
      }
      
      // Store token in session for next step
      ctx.session.limitBuySetup = {
        tokenAddress,
        riskLevel: riskAnalysis.riskLevel
      };
      
      // Update state
      ctx.session.state = 'WAITING_FOR_LIMIT_BUY_PRICE';
      
      // Send analysis result and ask for price
      let message = `${riskLevelEmoji} ${riskDescription} Risk Token (${riskAnalysis.riskLevel}%)\n\n`;
      
      if (riskAnalysis.warnings && riskAnalysis.warnings.length > 0) {
        message += `Warnings:\n• ${riskAnalysis.warnings.join('\n• ')}\n\n`;
      }
      
      message += `Token: ${tokenAddress}\n\n`;
      message += `Enter the price (in SOL) at which you want to buy this token:`;
      
      await ctx.reply(message);
    } catch (error) {
      logger.error(`Error in handleLimitBuyTokenInput: ${error.message}`);
      ctx.session.state = null;
      ctx.reply('Error validating token. Please try again.');
    }
  },
  
  /**
   * Handle limit buy price input
   * @param {Object} ctx - Telegram context
   * @param {string} priceText - Price input text
   */
  handleLimitBuyPriceInput: async (ctx, priceText) => {
    try {
      // Parse price input
      const price = parseFloat(priceText);
      
      if (isNaN(price) || price <= 0) {
        await ctx.reply('Invalid price. Please enter a valid positive number.');
        return;
      }
      
      // Store price in session
      ctx.session.limitBuySetup.price = price;
      
      // Update state
      ctx.session.state = 'WAITING_FOR_LIMIT_BUY_AMOUNT';
      
      // Ask for amount
      await ctx.reply(
        `How much SOL would you like to spend when this order executes?\n\n` +
        `Current wallet balance: ${ctx.session.wallet.balance} SOL`
      );
    } catch (error) {
      logger.error(`Error in handleLimitBuyPriceInput: ${error.message}`);
      ctx.session.state = null;
      ctx.reply('Error setting price. Please try again.');
    }
  },
  
  /**
   * Handle limit buy amount input
   * @param {Object} ctx - Telegram context
   * @param {string} amountText - Amount input text
   */
  handleLimitBuyAmountInput: async (ctx, amountText) => {
    try {
      // Parse amount input
      const amount = parseFloat(amountText);
      
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Invalid amount. Please enter a valid positive number.');
        return;
      }
      
      // Complete setup
      const limitBuyOrder = {
        id: `limit_${Date.now()}`,
        type: 'buy',
        tokenAddress: ctx.session.limitBuySetup.tokenAddress,
        price: ctx.session.limitBuySetup.price,
        amount: amount,
        createdAt: new Date(),
        status: 'active'
      };
      
      // Initialize limit orders if not exist
      if (!ctx.session.limitOrders) {
        ctx.session.limitOrders = [];
      }
      
      // Add to limit orders
      ctx.session.limitOrders.push(limitBuyOrder);
      
      // Reset state
      ctx.session.state = null;
      delete ctx.session.limitBuySetup;
      
      // Confirm order
      await ctx.reply(
        `✅ Limit Buy Order Created\n\n` +
        `Token: ${limitBuyOrder.tokenAddress.substring(0, 8)}...\n` +
        `Price: ${limitBuyOrder.price} SOL\n` +
        `Amount: ${limitBuyOrder.amount} SOL\n\n` +
        `Your order will execute automatically when the token reaches the target price.`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleLimitBuyAmountInput: ${error.message}`);
      ctx.session.state = null;
      ctx.reply('Error creating limit order. Please try again.');
    }
  },
  
  /**
   * Handle the Create DCA Order button
   * @param {Object} ctx - Telegram context
   */
  handleCreateDCA: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      // Check if we can execute real transactions
      if (solanaClient.demoMode || solanaClient.readOnlyMode) {
        return ctx.reply(
          `ℹ️ DCA Orders\n\n` +
          `This feature requires a wallet with a private key to execute transactions.\n\n` +
          `Currently the bot is in ${solanaClient.demoMode ? 'demo mode' : 'read-only mode'}. ` +
          `To enable real trading, please update your .env file with your PRIVATE_KEY.`,
          keyboards.backToMainKeyboard
        );
      }
      
      // Ask for token address
      await ctx.reply(
        `📋 Create DCA Order\n\n` +
        `Enter the token address you want to periodically buy:`,
        { reply_markup: { force_reply: true } }
      );
      
      // Set state to wait for token address
      ctx.session.state = 'WAITING_FOR_DCA_TOKEN';
    } catch (error) {
      logger.error(`Error in handleCreateDCA: ${error.message}`);
      ctx.reply('Error creating DCA order. Please try again.');
    }
  },
  
  /**
   * Handle DCA token input
   * @param {Object} ctx - Telegram context
   * @param {string} tokenAddress - Token address
   */
  handleDCATokenInput: async (ctx, tokenAddress) => {
    try {
      await ctx.reply(`Analyzing token: ${tokenAddress}...`);
      
      // Analyze token risk
      const riskAnalysis = await solanaClient.analyzeTokenRisk(tokenAddress);
      
      // Format risk level message
      let riskLevelEmoji = '✅';
      let riskDescription = 'Low';
      
      if (riskAnalysis.riskLevel > 70) {
        riskLevelEmoji = '🔴';
        riskDescription = 'High';
      } else if (riskAnalysis.riskLevel > 30) {
        riskLevelEmoji = '🟠';
        riskDescription = 'Medium';
      }
      
      // Store token in session for next step
      ctx.session.dcaSetup = {
        tokenAddress,
        riskLevel: riskAnalysis.riskLevel
      };
      
      // Update state
      ctx.session.state = 'WAITING_FOR_DCA_AMOUNT';
      
      // Send analysis result and ask for amount
      let message = `${riskLevelEmoji} ${riskDescription} Risk Token (${riskAnalysis.riskLevel}%)\n\n`;
      
      if (riskAnalysis.warnings && riskAnalysis.warnings.length > 0) {
        message += `Warnings:\n• ${riskAnalysis.warnings.join('\n• ')}\n\n`;
      }
      
      message += `Token: ${tokenAddress}\n\n`;
      message += `How much SOL would you like to spend in each purchase?`;
      
      await ctx.reply(message);
    } catch (error) {
      logger.error(`Error in handleDCATokenInput: ${error.message}`);
      ctx.session.state = null;
      ctx.reply('Error validating token. Please try again.');
    }
  },
  
  /**
   * Handle DCA amount input
   * @param {Object} ctx - Telegram context
   * @param {string} amountText - Amount input text
   */
  handleDCAAmountInput: async (ctx, amountText) => {
    try {
      // Parse amount input
      const amount = parseFloat(amountText);
      
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Invalid amount. Please enter a valid positive number.');
        return;
      }
      
      // Store amount in session
      ctx.session.dcaSetup.amount = amount;
      
      // Update state
      ctx.session.state = 'WAITING_FOR_DCA_INTERVAL';
      
      // Ask for interval
      await ctx.reply(
        `How often would you like to buy this token? (in hours)\n\n` +
        `Examples:\n` +
        `24 - Once a day\n` +
        `168 - Once a week\n` +
        `720 - Once a month`
      );
    } catch (error) {
      logger.error(`Error in handleDCAAmountInput: ${error.message}`);
      ctx.session.state = null;
      ctx.reply('Error setting amount. Please try again.');
    }
  },
  
  /**
   * Handle DCA interval input
   * @param {Object} ctx - Telegram context
   * @param {string} intervalText - Interval input text
   */
  handleDCAIntervalInput: async (ctx, intervalText) => {
    try {
      // Parse interval input
      const interval = parseInt(intervalText);
      
      if (isNaN(interval) || interval <= 0) {
        await ctx.reply('Invalid interval. Please enter a valid positive number.');
        return;
      }
      
      // Complete setup
      const dcaOrder = {
        id: `dca_${Date.now()}`,
        tokenAddress: ctx.session.dcaSetup.tokenAddress,
        amount: ctx.session.dcaSetup.amount,
        interval: interval,
        nextExecution: Date.now() + interval * 3600000, // Convert hours to milliseconds
        createdAt: new Date(),
        status: 'active'
      };
      
      // Initialize DCA orders if not exist
      if (!ctx.session.dcaOrders) {
        ctx.session.dcaOrders = [];
      }
      
      // Add to DCA orders
      ctx.session.dcaOrders.push(dcaOrder);
      
      // Reset state
      ctx.session.state = null;
      delete ctx.session.dcaSetup;
      
      // Confirm order
      await ctx.reply(
        `✅ DCA Order Created\n\n` +
        `Token: ${dcaOrder.tokenAddress.substring(0, 8)}...\n` +
        `Amount: ${dcaOrder.amount} SOL\n` +
        `Interval: Every ${dcaOrder.interval} hours\n\n` +
        `Your first purchase will execute in ${dcaOrder.interval} hours.`,
        keyboards.mainKeyboard
      );
    } catch (error) {
      logger.error(`Error in handleDCAIntervalInput: ${error.message}`);
      ctx.session.state = null;
      ctx.reply('Error creating DCA order. Please try again.');
    }
  },
  
  // Phantom wallet handlers
  /**
   * Handle deposit from Phantom button
   * @param {Object} ctx - Telegram context
   */
  handleDepositPhantom: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      // Get wallet address
      const walletAddress = solanaClient.getWalletAddress();
      
      if (!walletAddress) {
        return ctx.reply('No wallet address available. Please set up a wallet first.');
      }
      
      await ctx.reply(
        `💳 *Deposit from Phantom Wallet*\n\n` +
        `Transfer SOL from your Phantom wallet to fund this bot.\n\n` +
        `Wallet address: \`${walletAddress}\`\n\n` +
        `Use the options below to generate a Solana Pay link or QR code for easy transfer.`,
        {
          parse_mode: 'Markdown',
          ...keyboards.phantomDepositKeyboard
        }
      );
    } catch (error) {
      logger.error(`Error in handleDepositPhantom: ${error.message}`);
      ctx.reply('Error setting up Phantom deposit. Please try again.');
    }
  },
  
  /**
   * Handle generate QR code button
   * @param {Object} ctx - Telegram context
   */
  handleGenerateQR: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      // Send loading message
      const loadingMsg = await ctx.reply('Generating QR code...');
      
      // Get wallet address
      const walletAddress = solanaClient.getWalletAddress();
      
      if (!walletAddress) {
        return ctx.reply('No wallet address available. Please set up a wallet first.');
      }
      
      // Generate Solana Pay URL
      const transferRequest = solanaClient.phantomConnectManager.generateTransferRequestURL(
        walletAddress,
        null, // Let user decide amount
        null,
        'TraderTony Bot Deposit',
        'Fund your trading bot'
      );
      
      // Generate QR code
      const qrCode = await solanaClient.phantomConnectManager.generateQRCode(transferRequest.url);
      
      // Delete loading message
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      
      // Send QR code with instructions
      await ctx.replyWithPhoto(
        { source: Buffer.from(qrCode.split(',')[1], 'base64') },
        {
          caption: `📱 *Scan with Phantom Wallet*\n\n` +
                  `Scan this QR code with your Phantom wallet to deposit SOL to your trading bot.\n\n` +
                  `Wallet address: \`${walletAddress}\``,
          parse_mode: 'Markdown',
          ...keyboards.phantomDepositKeyboard
        }
      );
      
      // Store reference in session for monitoring
      ctx.session.pendingDeposit = {
        reference: transferRequest.reference,
        timestamp: Date.now()
      };
      
    } catch (error) {
      logger.error(`Error in handleGenerateQR: ${error.message}`);
      ctx.reply('Error generating QR code. Please try again.');
    }
  },
  
  /**
   * Handle copy pay link button
   * @param {Object} ctx - Telegram context
   */
  handleCopyPayLink: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      // Get wallet address
      const walletAddress = solanaClient.getWalletAddress();
      
      if (!walletAddress) {
        return ctx.reply('No wallet address available. Please set up a wallet first.');
      }
      
      // Generate Solana Pay URL
      const transferRequest = solanaClient.phantomConnectManager.generateTransferRequestURL(
        walletAddress,
        null, // Let user decide amount
        null,
        'TraderTony Bot Deposit',
        'Fund your trading bot'
      );
      
      // Send URL to user
      await ctx.reply(
        `🔗 *Solana Pay Link*\n\n` +
        `Use this link to deposit SOL from your Phantom wallet:\n\n` +
        `\`${transferRequest.url}\`\n\n` +
        `Click the link to open in Phantom or copy it to your clipboard.`,
        {
          parse_mode: 'Markdown',
          ...keyboards.phantomDepositKeyboard
        }
      );
      
      // Store reference in session for monitoring
      ctx.session.pendingDeposit = {
        reference: transferRequest.reference,
        timestamp: Date.now()
      };
      
    } catch (error) {
      logger.error(`Error in handleCopyPayLink: ${error.message}`);
      ctx.reply('Error generating Solana Pay link. Please try again.');
    }
  },
  
  /**
   * Handle withdraw to Phantom button
   * @param {Object} ctx - Telegram context
   */
  handleWithdrawPhantom: async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      // Check if we can execute real transactions
      if (solanaClient.demoMode) {
        return ctx.reply(
          `⚠️ *Withdraw to Phantom*\n\n` +
          `This feature requires a wallet with a private key to execute transactions.\n\n` +
          `Currently the bot is in demo mode. To enable real transactions, please update your .env file with your PRIVATE_KEY.`,
          {
            parse_mode: 'Markdown',
            ...keyboards.backToMainKeyboard
          }
        );
      }
      
      // Get current wallet balance
      const balance = await solanaClient.getBalance();
      
      await ctx.reply(
        `💸 *Withdraw to Phantom Wallet*\n\n` +
        `Current balance: ${balance} SOL\n\n` +
        `Select an amount to withdraw or enter a custom amount:`,
        {
          parse_mode: 'Markdown',
          ...keyboards.phantomWithdrawKeyboard
        }
      );
      
      // Set state to wait for withdrawal address
      ctx.session.state = 'WAITING_FOR_WITHDRAW_ADDRESS';
      
    } catch (error) {
      logger.error(`Error in handleWithdrawPhantom: ${error.message}`);
      ctx.reply('Error setting up Phantom withdrawal. Please try again.');
    }
  },
  
  /**
   * Handle withdrawal amount selection
   * @param {Object} ctx - Telegram context
   * @param {string} amount - Amount to withdraw (e.g., '0.1')
   */
  handleWithdrawalAmount: async (ctx, amount) => {
    try {
      await ctx.answerCbQuery();
      
      // Check for valid amount
      const withdrawAmount = parseFloat(amount);
      if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        return ctx.reply('Invalid withdrawal amount. Please try again.');
      }
      
      // Check if we have enough balance
      const balance = await solanaClient.getBalance();
      if (withdrawAmount > balance) {
        return ctx.reply(`Insufficient balance. You only have ${balance} SOL available.`);
      }
      
      // Ask for recipient address
      await ctx.reply(
        `🔍 *Enter Recipient Address*\n\n` +
        `Please enter the Phantom wallet address to withdraw ${withdrawAmount} SOL to:`,
        { parse_mode: 'Markdown' }
      );
      
      // Store amount and set state
      ctx.session.withdrawAmount = withdrawAmount;
      ctx.session.state = 'WAITING_FOR_WITHDRAW_ADDRESS';
      
    } catch (error) {
      logger.error(`Error in handleWithdrawalAmount: ${error.message}`);
      ctx.reply('Error processing withdrawal amount. Please try again.');
    }
  },
  
  /**
   * Handle withdraw address input
   * @param {Object} ctx - Telegram context
   * @param {string} address - Recipient address
   */
  handleWithdrawAddressInput: async (ctx, address) => {
    try {
      // Validate the address
      try {
        new solanaClient.connection.constructor.PublicKey(address);
      } catch (error) {
        return ctx.reply('Invalid Solana address. Please enter a valid address.');
      }
      
      // Send confirmation message
      await ctx.reply(
        `⚠️ *Confirm Withdrawal*\n\n` +
        `You are about to withdraw ${ctx.session.withdrawAmount} SOL to:\n` +
        `\`${address}\`\n\n` +
        `Are you sure you want to proceed?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Confirm', callback_data: `confirm_withdraw_${address}` },
                { text: '❌ Cancel', callback_data: 'fund' }
              ]
            ]
          }
        }
      );
      
      // Reset state
      ctx.session.state = null;
      
    } catch (error) {
      logger.error(`Error in handleWithdrawAddressInput: ${error.message}`);
      ctx.reply('Error processing withdrawal address. Please try again.');
      ctx.session.state = null;
    }
  },
  
  /**
   * Handle withdrawal confirmation
   * @param {Object} ctx - Telegram context
   * @param {string} address - Recipient address
   */
  handleConfirmWithdrawal: async (ctx, address) => {
    try {
      await ctx.answerCbQuery();
      
      // Check if withdrawal amount is set
      if (!ctx.session.withdrawAmount) {
        return ctx.reply('Withdrawal amount not set. Please start over.');
      }
      
      // Send processing message
      const processingMsg = await ctx.reply('Processing withdrawal...');
      
      // Generate and execute withdrawal transaction
      try {
        // Generate transaction
        const transaction = await solanaClient.phantomConnectManager.generateWithdrawalTransaction(
          address,
          ctx.session.withdrawAmount
        );
        
        // Execute transaction
        const txResult = await solanaClient.transactionUtility.sendTransaction(transaction);
        
        // Delete processing message
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
        
        if (txResult.success) {
          // Send success message
          await ctx.reply(
            `✅ *Withdrawal Successful*\n\n` +
            `Successfully withdrew ${ctx.session.withdrawAmount} SOL to:\n` +
            `\`${address}\`\n\n` +
            `Transaction ID: \`${txResult.signature}\``,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🔍 View on Solscan', url: `https://solscan.io/tx/${txResult.signature}` }
                  ],
                  [
                    { text: '« Back to Main Menu', callback_data: 'refresh' }
                  ]
                ]
              }
            }
          );
        } else {
          throw new Error(txResult.error || 'Unknown error');
        }
      } catch (error) {
        // Delete processing message
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
        
        // Send error message
        await ctx.reply(
          `❌ *Withdrawal Failed*\n\n` +
          `Error: ${error.message}\n\n` +
          `Please try again later.`,
          {
            parse_mode: 'Markdown',
            ...keyboards.backToMainKeyboard
          }
        );
      }
      
      // Clear withdrawal data
      delete ctx.session.withdrawAmount;
      
    } catch (error) {
      logger.error(`Error in handleConfirmWithdrawal: ${error.message}`);
      ctx.reply('Error processing withdrawal. Please try again.');
    }
  },
  
  updateMonitoredTokens
};