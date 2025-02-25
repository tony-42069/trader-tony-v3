const { PublicKey } = require('@solana/web3.js');
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
    
    // Load positions from database
    this.loadPositions();
    
    logger.info('Position manager initialized');
  }

  /**
   * Load positions from the database
   */
  loadPositions() {
    try {
      this.positions = database.loadPositions();
      logger.info(`Loaded ${this.positions.size} positions from database`);
      
      // Start monitoring if there are open positions
      if (this.getOpenPositions().length > 0 && !this.monitoring) {
        this.startMonitoring();
      }
    } catch (error) {
      logger.error(`Failed to load positions from database: ${error.message}`);
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
      stopLoss: options.stopLoss || null,
      takeProfit: options.takeProfit || null,
      trailingStop: options.trailingStop || null,
      status: 'OPEN',
      createdAt: new Date(),
      highestPrice: entryPrice
    };
    
    this.positions.set(positionId, position);
    logger.info(`New position created: ${positionId} for token ${tokenAddress}`);
    
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
    this.monitoring = true;
    logger.info('Position monitoring started');
    
    // Set up interval to check prices and manage positions
    this.monitorInterval = setInterval(async () => {
      try {
        await this.checkPositions();
      } catch (error) {
        logger.error(`Error monitoring positions: ${error.message}`);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop monitoring positions
   */
  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
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
      logger.info('No open positions to monitor, stopping position monitor');
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
    
    // Check each token's price and update positions
    for (const [tokenAddress, positions] of tokenGroups) {
      try {
        const currentPrice = await this.getTokenPrice(tokenAddress);
        logger.debug(`Current price for token ${tokenAddress}: ${currentPrice}`);
        
        for (const position of positions) {
          // Update highest price if needed (for trailing stop)
          if (currentPrice > position.highestPrice) {
            position.highestPrice = currentPrice;
            logger.debug(`New highest price for position ${position.id}: ${currentPrice}`);
            // Save the updated highest price
            this.positions.set(position.id, position);
            this.savePositions();
          }
          
          // Check take profit
          if (position.takeProfit && currentPrice >= position.entryPrice * (1 + position.takeProfit / 100)) {
            logger.info(`Take profit triggered for position ${position.id} at price ${currentPrice}`);
            await this.executeSell(position, currentPrice, 'TAKE_PROFIT');
            continue;
          }
          
          // Check stop loss
          if (position.stopLoss && currentPrice <= position.entryPrice * (1 - position.stopLoss / 100)) {
            logger.info(`Stop loss triggered for position ${position.id} at price ${currentPrice}`);
            await this.executeSell(position, currentPrice, 'STOP_LOSS');
            continue;
          }
          
          // Check trailing stop
          if (position.trailingStop && 
              currentPrice <= position.highestPrice * (1 - position.trailingStop / 100)) {
            logger.info(`Trailing stop triggered for position ${position.id} at price ${currentPrice}`);
            await this.executeSell(position, currentPrice, 'TRAILING_STOP');
            continue;
          }
        }
      } catch (error) {
        logger.error(`Error checking positions for token ${tokenAddress}: ${error.message}`);
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
      // Jupiter API doesn't require an API key for free tier
      // Documentation: https://price.jup.ag/docs
      try {
        const jupiterUrl = `https://price.jup.ag/v4/price?ids=${tokenAddress}&vsToken=SOL`;
        const response = await axios.get(jupiterUrl, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.data && response.data.data && response.data.data[tokenAddress]) {
          const priceData = response.data.data[tokenAddress];
          logger.debug(`Got price from Jupiter for ${tokenAddress}: ${priceData.price}`);
          return priceData.price;
        } else {
          throw new Error('Invalid response format from Jupiter API');
        }
      } catch (jupiterError) {
        logger.debug(`Jupiter price fetch failed: ${jupiterError.message}`);
        // Continue to fallback methods
      }
      
      // If Jupiter fails, try another public price API
      try {
        const pythUrl = `https://hermes.pyth.network/api/latest_price_feeds?ids%5B%5D=${tokenAddress}`;
        const response = await axios.get(pythUrl);
        
        if (response.data && response.data.length > 0) {
          const priceData = response.data[0];
          return priceData.price;
        }
      } catch (pythError) {
        logger.debug(`Pyth price fetch failed: ${pythError.message}`);
      }
      
      // Fallback to simulated price for demo purposes
      logger.debug(`Using simulated price for ${tokenAddress}`);
      const position = this.getPositionsByToken(tokenAddress)[0];
      
      if (position) {
        // Generate a more realistic price movement based on entry price
        const entryPrice = position.entryPrice;
        const volatilityFactor = 0.1; // 10% max movement
        const randomMovement = (Math.random() * 2 - 1) * volatilityFactor;
        return entryPrice * (1 + randomMovement);
      } else {
        // No position found, generate a random price
        return 0.0001 + (Math.random() * 0.001);
      }
    } catch (error) {
      logger.error(`Error fetching price for token ${tokenAddress}: ${error.message}`);
      // Return last known price or default to 1.0 on complete failure
      return 1.0;
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
   * Execute a sell transaction
   * @param {Object} position - Position to sell
   * @param {number} currentPrice - Current token price
   * @param {string} reason - Reason for selling
   * @returns {Promise<boolean>} Success status
   */
  async executeSell(position, currentPrice, reason) {
    try {
      logger.info(`Executing sell for position ${position.id}, reason: ${reason}`);
      
      // In production, this would create and send a transaction to sell the token
      // For now, just simulate a successful sale
      
      // Mark position as closed
      this.closePosition(position.id, currentPrice, reason);
      
      // Emit event
      this.emit('sellExecuted', {
        positionId: position.id,
        tokenAddress: position.tokenAddress,
        price: currentPrice,
        reason
      });
      
      return true;
    } catch (error) {
      logger.error(`Error executing sell for position ${position.id}: ${error.message}`);
      return false;
    }
  }
}

module.exports = PositionManager; 