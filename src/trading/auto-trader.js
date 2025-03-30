const { PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const database = require('../utils/database');
const crypto = require('crypto');

/**
 * AutoTrader class to handle autonomous trading strategies
 * Extends EventEmitter to provide events for trade updates
 */
class AutoTrader extends EventEmitter {
  constructor(connection, wallet, tokenSniper, positionManager, riskAnalyzer, jupiterClient) {
    super();
    this.connection = connection;
    this.wallet = wallet;
    this.tokenSniper = tokenSniper;
    this.positionManager = positionManager;
    this.riskAnalyzer = riskAnalyzer;
    this.jupiterClient = jupiterClient;
    this.strategies = new Map();
    this.opportunitiesByStrategy = new Map(); // Store opportunities per strategy
    this.running = false;
    this.scanInterval = null;
    this.tradeInterval = null;
    
    // Load strategies from database
    this.loadStrategies();
    
    logger.info('AutoTrader initialized');
  }

  /**
   * Load trading strategies from the database
   */
  loadStrategies() {
    try {
      const strategies = database.loadAutoTraderStrategies() || [];
      strategies.forEach(strategy => {
        this.strategies.set(strategy.id, strategy);
      });
      logger.info(`Loaded ${this.strategies.size} trading strategies from database`);
    } catch (error) {
      logger.error(`Failed to load strategies from database: ${error.message}`);
      // Initialize with empty strategies
      this.strategies = new Map();
    }
  }
  
  /**
   * Save trading strategies to the database
   */
  saveStrategies() {
    try {
      database.saveAutoTraderStrategies(Array.from(this.strategies.values()));
      logger.info(`Saved ${this.strategies.size} trading strategies to database`);
    } catch (error) {
      logger.error(`Failed to save strategies to database: ${error.message}`);
    }
  }

  /**
   * Add a new trading strategy
   * @param {Object} strategyConfig - Strategy configuration
   * @returns {Object} The created strategy
   */
  addStrategy(strategyConfig) {
    const strategyId = Date.now().toString();
    const strategy = {
      id: strategyId,
      name: strategyConfig.name || `Strategy ${strategyId.substring(0, 5)}`,
      enabled: true,
      createdAt: new Date(),
      lastRun: null,
      stats: {
        totalTrades: 0,
        successfulTrades: 0,
        failedTrades: 0,
        profit: 0
      },
      config: {
        // Trading parameters
        maxConcurrentPositions: strategyConfig.maxConcurrentPositions || 3,
        maxPositionSizeSOL: strategyConfig.maxPositionSizeSOL || 0.1,
        totalBudgetSOL: strategyConfig.totalBudgetSOL || 1.0,
        
        // Risk parameters
        stopLoss: strategyConfig.stopLoss || 10,
        takeProfit: strategyConfig.takeProfit || 30,
        trailingStop: strategyConfig.trailingStop || null,
        maxRiskLevel: strategyConfig.maxRiskLevel || 50,
        
        // Scan parameters
        scanIntervalMinutes: strategyConfig.scanIntervalMinutes || 5,
        minLiquiditySOL: strategyConfig.minLiquiditySOL || 10,
        minHolders: strategyConfig.minHolders || 50,
        
        // Token filter
        tokenFilters: strategyConfig.tokenFilters || {
          excludeNSFW: true,
          excludeMemeTokens: false,
          minAgeHours: 0,
          maxAgeHours: 72,
        },
        
        // Trading conditions
        tradingConditions: strategyConfig.tradingConditions || {
          minPriceChangePercent: 5,
          timeframeMinutes: 15,
          minVolume: 5, // SOL
          volumeIncreasePercent: 20
        },
        
        // Notification settings
        notifications: strategyConfig.notifications || {
          onEntry: true,
          onExit: true,
          onError: true
        }
      }
    };
    
    this.strategies.set(strategyId, strategy);
    logger.info(`New trading strategy created: ${strategyId} - ${strategy.name}`);
    
    // Save strategies to database
    this.saveStrategies();
    
    // Emit strategy created event
    this.emit('strategyCreated', strategy);
    
    // If auto trader is running, apply this strategy immediately
    if (this.running) {
      this.applyStrategy(strategy);
    }
    
    return strategy;
  }

  /**
   * Get a strategy by ID
   * @param {string} strategyId - Strategy ID
   * @returns {Object|null} The strategy or null if not found
   */
  getStrategy(strategyId) {
    return this.strategies.get(strategyId);
  }

  /**
   * Get all strategies
   * @returns {Array} Array of all strategies
   */
  getAllStrategies() {
    return Array.from(this.strategies.values());
  }

  /**
   * Update a strategy
   * @param {string} strategyId - Strategy ID
   * @param {Object} updates - Properties to update
   * @returns {Object|null} Updated strategy or null if not found
   */
  updateStrategy(strategyId, updates) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      logger.warn(`Attempted to update non-existent strategy: ${strategyId}`);
      return null;
    }
    
    // Update config properties
    if (updates.config) {
      strategy.config = {
        ...strategy.config,
        ...updates.config
      };
    }
    
    // Update other properties
    const { config, ...otherUpdates } = updates;
    Object.assign(strategy, otherUpdates);
    
    this.strategies.set(strategyId, strategy);
    logger.info(`Strategy ${strategyId} updated`);
    
    // Save strategies to database
    this.saveStrategies();
    
    // Emit strategy updated event
    this.emit('strategyUpdated', strategy);
    
    return strategy;
  }

  /**
   * Delete a strategy
   * @param {string} strategyId - Strategy ID
   * @returns {boolean} Whether the strategy was deleted
   */
  deleteStrategy(strategyId) {
    const success = this.strategies.delete(strategyId);
    
    if (success) {
      logger.info(`Strategy ${strategyId} deleted`);
      this.saveStrategies();
      this.emit('strategyDeleted', strategyId);
    }
    
    return success;
  }

  /**
   * Start autonomous trading
   * @returns {boolean} Success status
   */
  start() {
    try {
      if (this.running) {
        logger.info('AutoTrader is already running');
        return true;
      }
      
      if (!this.wallet || !this.tokenSniper || !this.positionManager) {
        logger.error('Cannot start AutoTrader: Required components not initialized');
        return false;
      }
      
      if (this.wallet.demoMode) {
        logger.info('Starting AutoTrader in DEMO MODE');
      } else {
        logger.info('Starting AutoTrader with REAL WALLET');
      }
      
      this.running = true;
      
      // Set up interval for token scanning
      this.scanInterval = setInterval(() => {
        this.scanForTradingOpportunities();
      }, 60000); // Scan every minute
      
      // Set up interval for strategy execution and position management
      this.tradeInterval = setInterval(() => {
        this.executeStrategies();
        this.managePositions();
      }, 30000); // Check every 30 seconds
      
      // Apply initial strategies
      this.executeStrategies();
      
      logger.info('AutoTrader started successfully');
      this.emit('started');
      
      return true;
    } catch (error) {
      logger.error(`Failed to start AutoTrader: ${error.message}`);
      return false;
    }
  }

  /**
   * Stop autonomous trading
   */
  stop() {
    if (!this.running) {
      logger.info('AutoTrader is not running');
      return;
    }
    
    // Clear intervals
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    if (this.tradeInterval) {
      clearInterval(this.tradeInterval);
      this.tradeInterval = null;
    }
    
    this.running = false;
    logger.info('AutoTrader stopped');
    this.emit('stopped');
  }

  /**
   * Scan for new trading opportunities
   */
  async scanForTradingOpportunities() {
    if (!this.running) return;
    
    try {
      logger.info('Scanning for new memecoin opportunities...');
      
      // In real implementation, we would:
      // 1. Query Jupiter or other DEX aggregators for newly added tokens
      // 2. Filter for tokens created in the last 15 minutes
      // 3. Analyze token metadata for memecoin characteristics
      
      // For each active strategy
      const enabledStrategies = Array.from(this.strategies.values())
        .filter(strategy => strategy.enabled);
      
      if (enabledStrategies.length === 0) {
        logger.info('No enabled strategies to execute');
        return;
      }
      
      // In demo mode, occasionally simulate finding a new memecoin (approximately 1 in 10 scans)
      if (this.wallet.demoMode && Math.random() < 0.1) {
        // Generate a random token address
        const randomBytes = crypto.randomBytes(32);
        const tokenAddress = new PublicKey(randomBytes).toString();
        
        // Token metadata with memecoin characteristics
        const tokenMetadata = {
          name: this.generateMemeTokenName(),
          symbol: this.generateMemeTokenSymbol(),
          createdAt: new Date(Date.now() - Math.floor(Math.random() * 15 * 60000)), // 0-15 minutes ago
          initialLiquiditySOL: 10 + Math.random() * 100, // 10-110 SOL
          holderCount: Math.floor(Math.random() * 50) + 10, // 10-60 holders
          isMemecoin: true,
          supply: 1000000000 + Math.floor(Math.random() * 9000000000), // 1-10B supply
          priceChangePercent: Math.random() * 30, // 0-30% price change
          volumeIncreasePercent: 50 + Math.random() * 200, // 50-250% volume increase
          potentialRisk: Math.floor(Math.random() * 40) + 10 // 10-50% risk level
        };
        
        logger.info(`[DEMO] Found new memecoin: ${tokenMetadata.name} (${tokenMetadata.symbol})`);
        logger.info(`[DEMO] Token address: ${tokenAddress}`);
        logger.info(`[DEMO] Created: ${Math.floor((Date.now() - tokenMetadata.createdAt) / 60000)} minutes ago`);
        logger.info(`[DEMO] Initial liquidity: ${tokenMetadata.initialLiquiditySOL.toFixed(2)} SOL`);
        
        // For each enabled strategy, check if this token meets criteria
        for (const strategy of enabledStrategies) {
          // Check if the token meets the strategy criteria for memecoins
          if (
            // Liquidity check
            tokenMetadata.initialLiquiditySOL >= strategy.config.minLiquiditySOL &&
            
            // Age check (within last 15 minutes, configurable in strategy)
            (Date.now() - tokenMetadata.createdAt) <= (strategy.config.maxTokenAgeMinutes || 15) * 60000 &&
            
            // Risk level check
            tokenMetadata.potentialRisk <= strategy.config.maxRiskLevel &&
            
            // Minimum holder count
            tokenMetadata.holderCount >= strategy.config.minHolders
          ) {
            logger.info(`[DEMO] Token ${tokenMetadata.symbol} meets criteria for strategy: ${strategy.name}`);
            
            // Store token for strategy execution
            if (!this.opportunitiesByStrategy.has(strategy.id)) {
              this.opportunitiesByStrategy.set(strategy.id, []);
            }
            
            this.opportunitiesByStrategy.get(strategy.id).push({
              tokenAddress,
              metadata: tokenMetadata,
              discoveredAt: new Date()
            });
            
            // Notify admin about the opportunity
            this.emit('tokenDiscovered', {
              strategy,
              tokenAddress,
              tokenName: tokenMetadata.name,
              tokenSymbol: tokenMetadata.symbol,
              createdAgo: `${Math.floor((Date.now() - tokenMetadata.createdAt) / 60000)} minutes ago`,
              liquidity: `${tokenMetadata.initialLiquiditySOL.toFixed(2)} SOL`
            });
          } else {
            logger.debug(`[DEMO] Token ${tokenMetadata.symbol} does not meet criteria for strategy: ${strategy.name}`);
          }
        }
      }
      
      logger.info('Memecoin token scan completed');
    } catch (error) {
      logger.error(`Error scanning for opportunities: ${error.message}`);
    }
  }
  
  /**
   * Generate a random memecoin name
   * @returns {string} Random memecoin name
   */
  generateMemeTokenName() {
    const prefixes = ['Moon', 'Doge', 'Shib', 'Pepe', 'Wojak', 'Chad', 'Ape', 'Frog', 'Cat', 'Sol', 'Elon', 'Baby', 'Floki', 'Space', 'Galaxy', 'Cyber', 'Meme', 'Magic', 'Rocket', 'Based'];
    const suffixes = ['Inu', 'Moon', 'Rocket', 'Lambo', 'Coin', 'Token', 'Doge', 'Floki', 'Cash', 'Money', 'Gold', 'Diamond', 'Hands', 'King', 'Lord', 'God', 'Star', 'AI', 'Chain', 'Dao'];
    
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    
    return `${prefix}${suffix}`;
  }
  
  /**
   * Generate a random memecoin symbol
   * @returns {string} Random memecoin symbol
   */
  generateMemeTokenSymbol() {
    const name = this.generateMemeTokenName();
    // Take first 3-5 letters to form a symbol
    const length = 3 + Math.floor(Math.random() * 3); // 3-5 characters
    let symbol = name.substring(0, length).toUpperCase();
    
    // Ensure symbols are at least 3 characters by adding 'X' if needed
    while (symbol.length < 3) {
      symbol += 'X';
    }
    
    return symbol;
  }

  /**
   * Execute strategies across enabled trading strategies
   */
  async executeStrategies() {
    if (!this.running) return;
    
    try {
      // Get only enabled strategies
      const enabledStrategies = Array.from(this.strategies.values())
        .filter(strategy => strategy.enabled);
      
      if (enabledStrategies.length === 0) {
        return;
      }
      
      logger.info(`Executing ${enabledStrategies.length} trading strategies...`);
      
      // Process each strategy
      for (const strategy of enabledStrategies) {
        try {
          // Get opportunities for this strategy
          const opportunities = this.opportunitiesByStrategy.get(strategy.id) || [];
          
          // Skip if no opportunities
          if (opportunities.length === 0) {
            logger.debug(`No opportunities for strategy ${strategy.name}`);
            continue;
          }
          
          // Sort by newest first
          opportunities.sort((a, b) => b.discoveredAt - a.discoveredAt);
          
          // Take the newest opportunity
          const opportunity = opportunities[0];
          
          // Don't process opportunities we've already seen or traded
          if (opportunity.processed) {
            continue;
          }
          
          logger.info(`Processing opportunity for ${opportunity.metadata.name} (${opportunity.metadata.symbol})`);
          
          // Mark as processed to avoid duplicate trades
          opportunity.processed = true;
          
          // Apply the strategy to this opportunity
          await this.applyStrategy(strategy, opportunity);
          
        } catch (strategyError) {
          logger.error(`Error applying strategy ${strategy.id}: ${strategyError.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error executing strategies: ${error.message}`);
    }
  }

  /**
   * Apply a specific trading strategy to a given opportunity
   * @param {Object} strategy - The strategy to apply
   * @param {Object} opportunity - The trading opportunity
   */
  async applyStrategy(strategy, opportunity = null) {
    try {
      logger.info(`Applying strategy: ${strategy.name} (${strategy.id})`);
      
      // Skip if max concurrent positions reached
      const activePositions = this.positionManager.getOpenPositions();
      const strategyPositions = activePositions.filter(
        pos => pos.strategyId === strategy.id
      );
      
      if (strategyPositions.length >= strategy.config.maxConcurrentPositions) {
        logger.info(`Strategy ${strategy.name} at max concurrent positions (${strategy.config.maxConcurrentPositions})`);
        return;
      }
      
      // Calculate how much we can invest right now
      const usedBudget = strategyPositions.reduce((total, pos) => total + pos.initialInvestment, 0);
      const availableBudget = strategy.config.totalBudgetSOL - usedBudget;
      
      if (availableBudget < strategy.config.maxPositionSizeSOL * 0.5) {
        logger.info(`Strategy ${strategy.name} has insufficient remaining budget`);
        return;
      }
      
      // Determine position size (random between 50-100% of max position size for variety)
      const positionSizeFactor = 0.5 + (Math.random() * 0.5); // 50-100%
      const positionSizeSOL = Math.min(
        strategy.config.maxPositionSizeSOL * positionSizeFactor, 
        availableBudget
      );
      
      // If no opportunity was provided but we're in demo mode, create a simulated one
      if (!opportunity && this.wallet.demoMode) {
        const randomBytes = crypto.randomBytes(32);
        const tokenAddress = new PublicKey(randomBytes).toString();
        
        opportunity = {
          tokenAddress,
          metadata: {
            name: this.generateMemeTokenName(),
            symbol: this.generateMemeTokenSymbol(),
            initialLiquiditySOL: 10 + Math.random() * 100,
            potentialRisk: Math.floor(Math.random() * 40) + 10
          },
          discoveredAt: new Date()
        };
      }
      
      // Execute the trade if we have an opportunity
      if (opportunity) {
        const tokenAddress = opportunity.tokenAddress;
        const metadata = opportunity.metadata;
        
        logger.info(`Executing trade for ${metadata.name} (${metadata.symbol})`);
        logger.info(`Position size: ${positionSizeSOL.toFixed(4)} SOL`);
        
        if (this.wallet.demoMode) {
          // Simulate trade execution
          await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate delay
          
          // Create simulated trade result
          const tradeResult = {
            success: Math.random() > 0.1, // 90% success rate in demo
            tokenAddress,
            amountInSol: positionSizeSOL,
            signature: `demo_tx_${Date.now().toString(16)}`,
            positionId: `demo_pos_${Date.now().toString(16)}`,
            inAmount: positionSizeSOL,
            outAmount: positionSizeSOL * (1000 + Math.random() * 9000), // Random token amount
            priceImpactPct: 0.1 + Math.random() * 2.9, // 0.1-3% price impact
            entryPrice: 0.000001 * (1 + Math.random()), // Random entry price
            demoMode: true
          };
          
          // Update strategy stats
          strategy.lastRun = new Date();
          strategy.stats.totalTrades++;
          
          if (tradeResult.success) {
            strategy.stats.successfulTrades++;
            
            // Create a mock position for tracking
            if (this.positionManager) {
              const position = this.positionManager.addPosition(
                tokenAddress,
                tradeResult.entryPrice,
                tradeResult.outAmount,
                {
                  stopLoss: strategy.config.stopLoss,
                  takeProfit: strategy.config.takeProfit,
                  trailingStop: strategy.config.trailingStop,
                  strategyId: strategy.id,
                  initialInvestment: positionSizeSOL,
                  tokenName: metadata.name,
                  tokenSymbol: metadata.symbol,
                  isDemoPosition: true
                }
              );
              
              tradeResult.positionId = position.id;
            }
            
            // Send notification if enabled
            if (strategy.config.notifications.onEntry) {
              this.emit('tradeExecuted', { 
                strategy, 
                trade: tradeResult,
                tokenName: metadata.name,
                tokenSymbol: metadata.symbol
              });
            }
          } else {
            strategy.stats.failedTrades++;
            if (strategy.config.notifications.onError) {
              this.emit('tradeError', { 
                strategy, 
                error: 'Simulated trade failure',
                tokenName: metadata.name,
                tokenSymbol: metadata.symbol
              });
            }
          }
          
          // Save updated strategy
          this.saveStrategies();
          return tradeResult;
        } else {
          // REAL MODE would be implemented here for actual trading
          // This is just a placeholder - don't implement real trading without thorough testing
          logger.warn('Real trading mode is not implemented in this version for safety');
          return { success: false, error: 'Real trading mode not implemented' };
        }
      }
      
      logger.info(`Strategy ${strategy.name} execution completed`);
    } catch (error) {
      logger.error(`Error in strategy ${strategy.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Manage existing positions (check for exit conditions)
   */
  async managePositions() {
    if (!this.running) return;
    
    try {
      logger.info('Managing existing positions...');
      
      // This typically would be handled by the PositionManager's monitoring
      // But here we could add custom logic for strategy-specific position management
      
      // Get all open positions linked to our strategies
      const openPositions = this.positionManager.getOpenPositions()
        .filter(position => position.strategyId);
      
      for (const position of openPositions) {
        const strategy = this.strategies.get(position.strategyId);
        if (!strategy) continue;
        
        // Check if we need to adjust take-profit or trailing stop based on market conditions
        // This would implement dynamic exit management beyond simple SL/TP
      }
      
      logger.info('Position management completed');
    } catch (error) {
      logger.error(`Error managing positions: ${error.message}`);
    }
  }

  /**
   * Get performance statistics for all strategies
   * @returns {Object} Performance statistics
   */
  getPerformanceStats() {
    const strategies = this.getAllStrategies();
    
    // Calculate aggregate statistics
    let totalTrades = 0;
    let successfulTrades = 0;
    let failedTrades = 0;
    let totalProfit = 0;
    
    strategies.forEach(strategy => {
      totalTrades += strategy.stats.totalTrades;
      successfulTrades += strategy.stats.successfulTrades;
      failedTrades += strategy.stats.failedTrades;
      totalProfit += strategy.stats.profit;
    });
    
    return {
      strategyCount: strategies.length,
      activeStrategies: strategies.filter(s => s.enabled).length,
      totalTrades,
      successfulTrades,
      failedTrades,
      winRate: totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0,
      totalProfit
    };
  }
}

module.exports = AutoTrader; 