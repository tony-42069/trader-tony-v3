const { PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const database = require('../utils/database');

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
      logger.info('Scanning for trading opportunities...');
      
      // Implement token scanning logic based on Jupiter DEX data
      // This could monitor new tokens, liquidity changes, or price movements
      
      // Example: Track trending tokens or those with increasing volume
      
      // For each token that meets criteria, add to opportunity list
      // which will be processed by executeStrategies()
      
      logger.info('Token scan completed');
    } catch (error) {
      logger.error(`Error scanning for opportunities: ${error.message}`);
    }
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
          await this.applyStrategy(strategy);
        } catch (strategyError) {
          logger.error(`Error applying strategy ${strategy.id}: ${strategyError.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error executing strategies: ${error.message}`);
    }
  }

  /**
   * Apply a specific trading strategy
   * @param {Object} strategy - The strategy to apply
   */
  async applyStrategy(strategy) {
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
      
      const positionSizeSOL = Math.min(strategy.config.maxPositionSizeSOL, availableBudget);
      
      // Find tokens that match this strategy's criteria
      // This would be populated by scanForTradingOpportunities()
      // For now, this is a placeholder for where you'd implement your token selection logic
      
      // If a suitable token is found, execute the trade
      // This is a placeholder for the actual trading logic
      /*
      const tokenAddress = "suitableTokenAddress";
      
      // Check risk level first
      const riskAnalysis = await this.riskAnalyzer.analyzeToken(tokenAddress);
      
      if (riskAnalysis.riskLevel > strategy.config.maxRiskLevel) {
        logger.info(`Token ${tokenAddress} exceeds max risk level for strategy ${strategy.name}`);
        return;
      }
      
      // Execute the trade
      const tradeResult = await this.tokenSniper.snipeToken(
        tokenAddress,
        positionSizeSOL,
        {
          slippage: 5, // Higher slippage for auto-trading to ensure execution
          stopLoss: strategy.config.stopLoss,
          takeProfit: strategy.config.takeProfit,
          trailingStop: strategy.config.trailingStop,
          strategyId: strategy.id // Tag this position with the strategy ID
        }
      );
      
      // Update strategy stats
      strategy.lastRun = new Date();
      strategy.stats.totalTrades++;
      
      if (tradeResult.success) {
        strategy.stats.successfulTrades++;
        // Send notification if enabled
        if (strategy.config.notifications.onEntry) {
          this.emit('tradeExecuted', { strategy, trade: tradeResult });
        }
      } else {
        strategy.stats.failedTrades++;
        if (strategy.config.notifications.onError) {
          this.emit('tradeError', { strategy, error: tradeResult.error });
        }
      }
      
      // Save updated strategy
      this.saveStrategies();
      */
      
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