const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const database = require('../utils/database');
const axios = require('axios');

/**
 * PositionManager class to track open positions and manage stop-loss/take-profit execution
 * Extends EventEmitter to provide events for position updates
 */
class PositionManager extends EventEmitter {
  constructor(connection, wallet) {
    super();
    this.connection = connection;
    this.wallet = wallet;
    this.positions = new Map();
    this.monitoring = false;
    this.monitorInterval = null;
    this.jupiterClient = null;
    
    // Configuration
    this.monitoringFrequencyMs = 8000; // Check prices every 8 seconds
    this.maxConcurrentChecks = 5;     // Maximum number of concurrent price checks
    this.priceCache = new Map();      // Cache of recent prices
    this.priceCacheTTL = 30000;       // 30 seconds TTL for price cache
    this.priceChangeThreshold = 1;    // Log price changes greater than 1%
    this.sellRetryDelay = 5000;       // 5 seconds before retrying failed sells
    this.sellMaxRetries = 3;          // Maximum sell retry attempts
    
    // Partial profit taking configuration
    this.defaultPartialTakeProfitLevels = [
      { percentage: 30, sellPercentage: 20 }, // At 30% profit, sell 20% of position
      { percentage: 50, sellPercentage: 30 }, // At 50% profit, sell 30% of position
      { percentage: 100, sellPercentage: 40 } // At 100% profit, sell 40% of position
    ];
    
    // Initialize position tracking data
    this.positionSellAttempts = new Map(); // Track retry counts for sell attempts
    this.partialSellsExecuted = new Map(); // Track which partial take-profits have been executed
    
    // Load positions from database
    this.loadPositions();
    
    logger.info('Position manager initialized');
  }

  /**
   * Set the Jupiter client for executing swaps
   * @param {Object} jupiterClient - Jupiter client instance
   */
  setJupiterClient(jupiterClient) {
    this.jupiterClient = jupiterClient;
    logger.info('Jupiter client connected to position manager');
  }

  /**
   * Load positions from the database
   */
  loadPositions() {
    try {
      this.positions = database.loadPositions();
      logger.info(`Loaded ${this.positions.size} positions from database`);
      
      // Initialize tracking maps for loaded positions
      for (const position of this.positions.values()) {
        this.positionSellAttempts.set(position.id, 0);
        this.partialSellsExecuted.set(position.id, new Set());
      }
      
      // Start monitoring if there are open positions
      if (this.getOpenPositions().length > 0 && !this.monitoring) {
        this.startMonitoring();
      }
    } catch (error) {
      logger.error(`Failed to load positions from database: ${error.message}`);
      this.positions = new Map(); // Initialize empty positions
    }
  }
  
  /**
   * Save positions to the database
   */
  savePositions() {
    try {
      database.savePositions(this.positions);
    } catch (error) {
      logger.error(`Failed to save positions to database: ${error.message}`);
    }
  }

  /**
   * Add a new trading position
   * @param {string} tokenAddress - Token mint address
   * @param {number} entryPrice - Entry price in SOL
   * @param {number} amount - Amount of tokens purchased
   * @param {Object} options - Additional options (stopLoss, takeProfit, trailingStop)
   * @returns {Object} The created position
   */
  addPosition(tokenAddress, entryPrice, amount, options = {}) {
    const positionId = Date.now().toString();
    const position = {
      id: positionId,
      tokenAddress,
      entryPrice,
      amount,
      amountRemaining: amount, // Track remaining amount after partial sells
      stopLoss: options.stopLoss || null,
      takeProfit: options.takeProfit || null,
      trailingStop: options.trailingStop || null,
      partialTakeProfitLevels: options.partialTakeProfitLevels || [...this.defaultPartialTakeProfitLevels],
      maxHoldTime: options.maxHoldTime || null, // Max hold time in minutes
      status: 'OPEN',
      createdAt: new Date(),
      highestPrice: entryPrice,
      lastChecked: new Date(),
      partialSells: [] // Track partial sells
    };
    
    this.positions.set(positionId, position);
    logger.info(`New position created: ${positionId} for token ${tokenAddress}`);
    
    // Initialize tracking for the new position
    this.positionSellAttempts.set(positionId, 0);
    this.partialSellsExecuted.set(positionId, new Set());
    
    // Save positions to database
    this.savePositions();
    
    // Start monitoring if not already running
    if (!this.monitoring) {
      this.startMonitoring();
    }
    
    // Emit position created event
    this.emit('positionCreated', position);
    
    return position;
  }

  /**
   * Get a position by ID
   * @param {string} positionId - Position ID
   * @returns {Object|null} The position or null if not found
   */
  getPosition(positionId) {
    return this.positions.get(positionId);
  }

  /**
   * Get all positions
   * @returns {Array} Array of all positions
   */
  getAllPositions() {
    return Array.from(this.positions.values());
  }

  /**
   * Get all open positions
   * @returns {Array} Array of open positions
   */
  getOpenPositions() {
    return Array.from(this.positions.values())
      .filter(position => position.status === 'OPEN');
  }

  /**
   * Update a position
   * @param {string} positionId - Position ID
   * @param {Object} updates - Properties to update
   * @returns {Object|null} Updated position or null if not found
   */
  updatePosition(positionId, updates) {
    const position = this.positions.get(positionId);
    if (!position) {
      logger.warn(`Attempted to update non-existent position: ${positionId}`);
      return null;
    }
    
    Object.assign(position, updates);
    this.positions.set(positionId, position);
    logger.info(`Position ${positionId} updated`);
    
    // Save positions to database
    this.savePositions();
    
    // Emit position updated event
    this.emit('positionUpdated', position);
    
    return position;
  }

  /**
   * Close a position
   * @param {string} positionId - Position ID
   * @param {number} exitPrice - Exit price
   * @param {string} reason - Reason for closing (e.g., STOP_LOSS, TAKE_PROFIT)
   * @returns {Object|null} Closed position or null if not found
   */
  closePosition(positionId, exitPrice, reason) {
    const position = this.positions.get(positionId);
    if (!position) {
      logger.warn(`Attempted to close non-existent position: ${positionId}`);
      return null;
    }
    
    position.status = 'CLOSED';
    position.exitPrice = exitPrice;
    position.profit = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    position.closedAt = new Date();
    position.closeReason = reason;
    
    this.positions.set(positionId, position);
    logger.info(`Position ${positionId} closed. Reason: ${reason}, Profit: ${position.profit.toFixed(2)}%`);
    
    // Clean up tracking maps
    this.positionSellAttempts.delete(positionId);
    this.partialSellsExecuted.delete(positionId);
    
    // Save positions to database
    this.savePositions();
    
    // Emit position closed event
    this.emit('positionClosed', position);
    
    return position;
  }

  /**
   * Start monitoring positions
   */
  startMonitoring() {
    if (this.monitoring) return; // Already monitoring
    
    this.monitoring = true;
    logger.info('Position monitoring started');
    
    // Set up interval to check prices and manage positions
    this.monitorInterval = setInterval(async () => {
      try {
        await this.checkPositions();
      } catch (error) {
        logger.error(`Error monitoring positions: ${error.message}`);
      }
    }, this.monitoringFrequencyMs);
  }

  /**
   * Stop monitoring positions
   */
  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      this.monitoring = false;
      logger.info('Position monitoring stopped');
    }
  }

  /**
   * Check all open positions against current prices
   */
  async checkPositions() {
    const openPositions = this.getOpenPositions();
    
    if (openPositions.length === 0) {
      // No open positions, stop monitoring
      logger.debug('No open positions to monitor, stopping position monitor');
      this.stopMonitoring();
      return;
    }
    
    // Group positions by token to minimize API calls
    const tokenGroups = new Map();
    
    openPositions.forEach(position => {
      if (!tokenGroups.has(position.tokenAddress)) {
        tokenGroups.set(position.tokenAddress, []);
      }
      tokenGroups.get(position.tokenAddress).push(position);
    });
    
    // Process tokens in smaller batches to avoid rate limits
    const tokenAddresses = Array.from(tokenGroups.keys());
    const batchSize = Math.min(this.maxConcurrentChecks, tokenAddresses.length);
    
    // Process in batches
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      
      // Process each token in the batch concurrently
      await Promise.all(batch.map(async (tokenAddress) => {
        try {
          const currentPrice = await this.getTokenPrice(tokenAddress);
          if (currentPrice <= 0) {
            logger.warn(`Invalid price (${currentPrice}) for token ${tokenAddress}, skipping position check`);
            return;
          }
          
          const positions = tokenGroups.get(tokenAddress);
          logger.debug(`Checking ${positions.length} positions for token ${tokenAddress}, current price: ${currentPrice}`);
          
          for (const position of positions) {
            // Check if position has been open too long (time-based management)
            if (position.maxHoldTime) {
              const createdAt = new Date(position.createdAt).getTime();
              const maxHoldTimeMs = position.maxHoldTime * 60 * 1000;
              const now = Date.now();
              
              if (now - createdAt >= maxHoldTimeMs) {
                logger.info(`Maximum hold time reached for position ${position.id}, selling`);
                await this.executeSell(position, currentPrice, 'MAX_HOLD_TIME');
                continue;
              }
            }
            
            // Update highest price if needed (for trailing stop)
            if (currentPrice > position.highestPrice) {
              const previousHigh = position.highestPrice;
              position.highestPrice = currentPrice;
              logger.debug(`New highest price for position ${position.id}: ${currentPrice} (was: ${previousHigh})`);
              this.positions.set(position.id, position);
              this.savePositions();
            }
            
            // Check partial take profits
            const profitPercentage = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
            
            if (profitPercentage > 0 && position.partialTakeProfitLevels) {
              // Sort levels by percentage descending to hit highest levels first
              const sortedLevels = [...position.partialTakeProfitLevels].sort((a, b) => b.percentage - a.percentage);
              
              for (const level of sortedLevels) {
                const levelKey = `${level.percentage}`;
                const executedPartials = this.partialSellsExecuted.get(position.id) || new Set();
                
                // If we've reached this level and haven't executed it yet
                if (profitPercentage >= level.percentage && !executedPartials.has(levelKey)) {
                  logger.info(`Partial take profit triggered for position ${position.id} at level ${level.percentage}%, selling ${level.sellPercentage}% of position`);
                  await this.executePartialSell(position, currentPrice, level.sellPercentage, `PARTIAL_TP_${level.percentage}`);
                  
                  // Mark this level as executed
                  executedPartials.add(levelKey);
                  this.partialSellsExecuted.set(position.id, executedPartials);
                  
                  // Only do one partial take profit at a time
                  break;
                }
              }
            }
            
            // Check take profit (for remaining position)
            if (position.takeProfit && profitPercentage >= position.takeProfit) {
              logger.info(`Take profit triggered for position ${position.id} at price ${currentPrice} (${profitPercentage.toFixed(2)}%)`);
              await this.executeSell(position, currentPrice, 'TAKE_PROFIT');
              continue;
            }
            
            // Check stop loss
            if (position.stopLoss && profitPercentage <= -position.stopLoss) {
              logger.info(`Stop loss triggered for position ${position.id} at price ${currentPrice} (${profitPercentage.toFixed(2)}%)`);
              await this.executeSell(position, currentPrice, 'STOP_LOSS');
              continue;
            }
            
            // Check trailing stop
            if (position.trailingStop) {
              const priceDropPercentage = ((position.highestPrice - currentPrice) / position.highestPrice) * 100;
              
              if (priceDropPercentage >= position.trailingStop) {
                logger.info(`Trailing stop triggered for position ${position.id} at price ${currentPrice}, ${priceDropPercentage.toFixed(2)}% drop from highest price ${position.highestPrice}`);
                await this.executeSell(position, currentPrice, 'TRAILING_STOP');
                continue;
              }
            }
            
            // Update last checked timestamp
            position.lastChecked = new Date();
            this.positions.set(position.id, position);
          }
        } catch (error) {
          logger.error(`Error checking positions for token ${tokenAddress}: ${error.message}`);
        }
      }));
      
      // Small delay between batches if more to process
      if (i + batchSize < tokenAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  /**
   * Get current token price from Jupiter or another price oracle
   * @param {string} tokenAddress - Token mint address
   * @returns {Promise<number>} Current token price
   */
  async getTokenPrice(tokenAddress) {
    try {
      // Check cache first
      const now = Date.now();
      const cacheKey = tokenAddress;
      const cachedPrice = this.priceCache.get(cacheKey);
      
      if (cachedPrice && (now - cachedPrice.timestamp < this.priceCacheTTL)) {
        return cachedPrice.price;
      }
      
      // If we have Jupiter client, use it first (most reliable)
      if (this.jupiterClient) {
        try {
          const price = await this.jupiterClient.getTokenPrice(tokenAddress);
          if (price > 0) {
            // Update cache
            this.priceCache.set(cacheKey, {
              price,
              timestamp: now
            });
            
            // Check for significant price changes
            if (cachedPrice) {
              const priceDiff = Math.abs((price - cachedPrice.price) / cachedPrice.price * 100);
              if (priceDiff > this.priceChangeThreshold) {
                logger.info(`Token ${tokenAddress} price changed by ${priceDiff.toFixed(2)}% (${cachedPrice.price} -> ${price})`);
              }
            }
            
            return price;
          }
        } catch (jupError) {
          logger.debug(`Jupiter price fetch error: ${jupError.message}`);
          // Fall through to next method
        }
      }
      
      // Jupiter API (public endpoint) as fallback
      try {
        const jupiterUrl = `https://price.jup.ag/v4/price?ids=${tokenAddress}&vsToken=SOL`;
        const response = await axios.get(jupiterUrl, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000 // 5s timeout
        });
        
        if (response.data && response.data.data && response.data.data[tokenAddress]) {
          const priceData = response.data.data[tokenAddress];
          const price = priceData.price;
          
          // Update cache
          this.priceCache.set(cacheKey, {
            price,
            timestamp: now
          });
          
          return price;
        }
      } catch (jupiterError) {
        logger.debug(`Jupiter public API error: ${jupiterError.message}`);
      }
      
      // Fallback to any other available price sources
      
      // If all else fails, use last known price if available
      const positions = this.getPositionsByToken(tokenAddress);
      if (positions.length > 0) {
        // Use most recent position's entry price as fallback
        const position = positions.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];
        
        logger.warn(`Using fallback price for ${tokenAddress}: ${position.entryPrice}`);
        return position.entryPrice;
      }
      
      // Last resort - demo/simulation price
      logger.warn(`Using simulated price for ${tokenAddress}`);
      return 0.0001 + (Math.random() * 0.001);
    } catch (error) {
      logger.error(`Error fetching price for token ${tokenAddress}: ${error.message}`);
      return -1; // Indicate error
    }
  }

  /**
   * Get positions by token address
   * @param {string} tokenAddress - Token mint address
   * @returns {Array} Array of positions for the token
   */
  getPositionsByToken(tokenAddress) {
    return Array.from(this.positions.values())
      .filter(position => position.tokenAddress === tokenAddress);
  }

  /**
   * Execute a partial sell transaction
   * @param {Object} position - Position to partially sell
   * @param {number} currentPrice - Current token price
   * @param {number} percentageToSell - Percentage of remaining position to sell (0-100)
   * @param {string} reason - Reason for selling
   * @returns {Promise<boolean>} Success status
   */
  async executePartialSell(position, currentPrice, percentageToSell, reason) {
    try {
      if (percentageToSell <= 0 || percentageToSell > 100) {
        throw new Error(`Invalid percentage to sell: ${percentageToSell}`);
      }
      
      const amountToSell = position.amountRemaining * (percentageToSell / 100);
      if (amountToSell <= 0) {
        throw new Error('Nothing to sell (position amount is zero)');
      }
      
      logger.info(`Executing partial sell for position ${position.id}, selling ${percentageToSell}% (${amountToSell} tokens) at ${currentPrice}, reason: ${reason}`);
      
      let sellResult = null;
      
      // Use Jupiter client for real sells if available
      if (this.jupiterClient && !this.wallet.demoMode) {
        try {
          // Execute sell transaction
          sellResult = await this.jupiterClient.executeSwap(
            position.tokenAddress,
            'SOL',
            amountToSell,
            this.wallet,
            { slippage: 2.5 } // Higher slippage for sells to ensure they go through
          );
          
          if (!sellResult.success) {
            throw new Error(`Swap failed: ${sellResult.error}`);
          }
          
          logger.info(`Partial sell successful, txid: ${sellResult.signature}, received ${sellResult.outAmount} SOL`);
        } catch (swapError) {
          logger.error(`Swap error in partial sell: ${swapError.message}`);
          throw swapError;
        }
      } else {
        // Demo mode - simulate sell
        logger.info(`Demo mode: Simulating partial sell of ${amountToSell} tokens`);
        sellResult = {
          success: true,
          signature: `demo_tx_${Date.now().toString(16)}`,
          outAmount: amountToSell * currentPrice * LAMPORTS_PER_SOL
        };
      }
      
      // Update position
      const amountRemaining = position.amountRemaining - amountToSell;
      
      // Record this partial sell
      position.partialSells = position.partialSells || [];
      position.partialSells.push({
        timestamp: new Date(),
        amount: amountToSell,
        price: currentPrice,
        reason,
        soldForSol: sellResult.outAmount / LAMPORTS_PER_SOL,
        txid: sellResult.signature
      });
      
      position.amountRemaining = amountRemaining;
      this.positions.set(position.id, position);
      this.savePositions();
      
      // Emit event
      this.emit('partialSellExecuted', {
        positionId: position.id,
        tokenAddress: position.tokenAddress,
        amount: amountToSell,
        amountRemaining,
        price: currentPrice,
        reason,
        transactionId: sellResult.signature
      });
      
      return true;
    } catch (error) {
      logger.error(`Error executing partial sell for position ${position.id}: ${error.message}`);
      return false;
    }
  }

  /**
   * Execute a sell transaction for the entire remaining position
   * @param {Object} position - Position to sell
   * @param {number} currentPrice - Current token price
   * @param {string} reason - Reason for selling
   * @returns {Promise<boolean>} Success status
   */
  async executeSell(position, currentPrice, reason) {
    try {
      const positionId = position.id;
      
      // Check that there's something to sell
      if (!position.amountRemaining || position.amountRemaining <= 0) {
        logger.warn(`Nothing to sell for position ${positionId} (amount remaining is zero)`);
        // Still mark the position as closed since there's nothing left
        this.closePosition(positionId, currentPrice, reason);
        return true;
      }
      
      logger.info(`Executing sell for position ${positionId}, amount: ${position.amountRemaining}, reason: ${reason}`);
      
      // Handle retry logic
      const attempts = this.positionSellAttempts.get(positionId) || 0;
      if (attempts >= this.sellMaxRetries) {
        logger.error(`Max sell retries (${this.sellMaxRetries}) reached for position ${positionId}, marking as error`);
        this.updatePosition(positionId, { sellError: `Failed after ${attempts} attempts` });
        
        // Still emit event so callers know about the failure
        this.emit('sellFailed', {
          positionId,
          tokenAddress: position.tokenAddress,
          attempts,
          reason
        });
        
        return false;
      }
      
      // Increment retry counter
      this.positionSellAttempts.set(positionId, attempts + 1);
      
      let sellResult = null;
      
      // Use Jupiter client for real sells if available
      if (this.jupiterClient && !this.wallet.demoMode) {
        try {
          // Execute sell transaction
          sellResult = await this.jupiterClient.executeSwap(
            position.tokenAddress,
            'SOL',
            position.amountRemaining,
            this.wallet,
            { 
              slippage: reason === 'STOP_LOSS' ? 5 : 2, // Higher slippage for stop loss
              skipPreflight: reason === 'STOP_LOSS', // Skip preflight for stop loss for faster execution
              priorityFee: reason === 'STOP_LOSS' ? 100000 : 40000 // Higher priority for stop loss
            }
          );
          
          if (!sellResult.success) {
            throw new Error(`Swap failed: ${sellResult.error}`);
          }
          
          logger.info(`Sell successful for position ${positionId}, txid: ${sellResult.signature}, received ${sellResult.outAmount / LAMPORTS_PER_SOL} SOL`);
        } catch (swapError) {
          logger.error(`Swap error in sell: ${swapError.message}`);
          
          // For some errors, we want to retry
          if (attempts < this.sellMaxRetries) {
            logger.info(`Will retry selling position ${positionId} in ${this.sellRetryDelay}ms (attempt ${attempts + 1}/${this.sellMaxRetries})`);
            setTimeout(() => this.executeSell(position, currentPrice, reason), this.sellRetryDelay);
            return false;
          }
          
          throw swapError;
        }
      } else {
        // Demo mode - simulate sell
        logger.info(`Demo mode: Simulating sell of ${position.amountRemaining} tokens`);
        sellResult = {
          success: true,
          signature: `demo_tx_${Date.now().toString(16)}`,
          outAmount: position.amountRemaining * currentPrice * LAMPORTS_PER_SOL
        };
      }
      
      // Mark position as closed
      const closed = this.closePosition(positionId, currentPrice, reason);
      if (closed) {
        closed.exitTxid = sellResult.signature;
        closed.exitAmountSol = sellResult.outAmount / LAMPORTS_PER_SOL;
        this.positions.set(positionId, closed);
        this.savePositions();
      }
      
      // Emit event
      this.emit('sellExecuted', {
        positionId,
        tokenAddress: position.tokenAddress,
        price: currentPrice,
        reason,
        transactionId: sellResult.signature,
        amountSol: sellResult.outAmount / LAMPORTS_PER_SOL
      });
      
      return true;
    } catch (error) {
      logger.error(`Error executing sell for position ${position.id}: ${error.message}`);
      
      // Update position with error
      this.updatePosition(position.id, { 
        sellError: error.message,
        lastSellAttempt: new Date()
      });
      
      return false;
    }
  }
}

module.exports = PositionManager; 