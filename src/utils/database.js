const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Database utility for persisting data to disk
 */
class Database {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.ensureDataDirectory();
  }

  /**
   * Ensure the data directory exists
   */
  ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
        logger.info(`Created data directory at ${this.dataDir}`);
      } catch (error) {
        logger.error(`Failed to create data directory: ${error.message}`);
      }
    }
  }

  /**
   * Save positions to disk
   * @param {Map} positions - Map of positions
   * @returns {boolean} Success status
   */
  savePositions(positions) {
    try {
      const filePath = path.join(this.dataDir, 'positions.json');
      
      // Convert Map to Array for JSON serialization
      const positionsArray = Array.from(positions.values());
      
      // Save with our expected format - an object with a positions array
      fs.writeFileSync(
        filePath,
        JSON.stringify({ positions: positionsArray }, null, 2)
      );
      
      logger.info(`Saved ${positionsArray.length} positions to disk`);
      return true;
    } catch (error) {
      logger.error(`Failed to save positions: ${error.message}`);
      return false;
    }
  }

  /**
   * Load positions from disk
   * @returns {Map} Map of positions
   */
  loadPositions() {
    try {
      const filePath = path.join(this.dataDir, 'positions.json');
      
      if (!fs.existsSync(filePath)) {
        logger.info('No positions file found, starting with empty positions');
        return new Map();
      }
      
      const data = fs.readFileSync(filePath, 'utf8');
      const jsonData = JSON.parse(data);
      
      // Check if the parsed data is an object with a positions array
      // or directly an array of positions
      const positionsArray = Array.isArray(jsonData) ? jsonData : 
                            (jsonData.positions && Array.isArray(jsonData.positions)) ? 
                            jsonData.positions : [];
      
      // Create a new map from the array
      const positions = new Map();
      
      // Only iterate if we have positions
      if (positionsArray && positionsArray.length > 0) {
        positionsArray.forEach(position => {
          // Restore Date objects which were serialized as strings
          if (position.createdAt) position.createdAt = new Date(position.createdAt);
          if (position.closedAt) position.closedAt = new Date(position.closedAt);
          if (position.entryTimestamp) position.entryTimestamp = new Date(position.entryTimestamp);
          
          positions.set(position.id, position);
        });
      }
      
      logger.info(`Loaded ${positions.size} positions from disk`);
      return positions;
    } catch (error) {
      logger.error(`Failed to load positions: ${error.message}`);
      return new Map();
    }
  }

  /**
   * Save a specific type of data to disk
   * @param {string} key - Data key/name
   * @param {any} data - Data to save
   * @returns {boolean} Success status
   */
  saveData(key, data) {
    try {
      const filePath = path.join(this.dataDir, `${key}.json`);
      
      fs.writeFileSync(
        filePath,
        JSON.stringify(data, null, 2)
      );
      
      logger.info(`Saved data '${key}' to disk`);
      return true;
    } catch (error) {
      logger.error(`Failed to save data '${key}': ${error.message}`);
      return false;
    }
  }

  /**
   * Load a specific type of data from disk
   * @param {string} key - Data key/name
   * @param {any} defaultValue - Default value if no data exists
   * @returns {any} Loaded data or default value
   */
  loadData(key, defaultValue = null) {
    try {
      const filePath = path.join(this.dataDir, `${key}.json`);
      
      if (!fs.existsSync(filePath)) {
        logger.info(`No data file found for '${key}', using default value`);
        return defaultValue;
      }
      
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error(`Failed to load data '${key}': ${error.message}`);
      return defaultValue;
    }
  }

  /**
   * Save AutoTrader strategies to disk
   * @param {Array} strategies - Array of trading strategies
   * @returns {boolean} Success status
   */
  saveAutoTraderStrategies(strategies) {
    return this.saveData('autotrader-strategies', strategies);
  }

  /**
   * Load AutoTrader strategies from disk
   * @returns {Array} Array of trading strategies
   */
  loadAutoTraderStrategies() {
    const strategies = this.loadData('autotrader-strategies', []);
    
    // Restore Date objects
    strategies.forEach(strategy => {
      if (strategy.createdAt) strategy.createdAt = new Date(strategy.createdAt);
      if (strategy.lastRun) strategy.lastRun = new Date(strategy.lastRun);
    });
    
    return strategies;
  }

  /**
   * Add a trade to the trading history
   * @param {Object} trade - Trade data
   * @returns {boolean} Success status
   */
  recordTrade(trade) {
    try {
      const filePath = path.join(this.dataDir, 'trading-history.json');
      let history = [];
      
      // Load existing history if available
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        history = JSON.parse(data);
      }
      
      // Add the new trade with timestamp
      trade.timestamp = trade.timestamp || new Date();
      history.push(trade);
      
      // Save updated history
      fs.writeFileSync(
        filePath,
        JSON.stringify(history, null, 2)
      );
      
      logger.info(`Recorded trade ${trade.id} in trading history`);
      return true;
    } catch (error) {
      logger.error(`Failed to record trade: ${error.message}`);
      return false;
    }
  }

  /**
   * Get trading history, optionally filtered by parameters
   * @param {Object} filters - Filters to apply
   * @returns {Array} Filtered trade history
   */
  getTradingHistory(filters = {}) {
    try {
      const filePath = path.join(this.dataDir, 'trading-history.json');
      
      if (!fs.existsSync(filePath)) {
        return [];
      }
      
      const data = fs.readFileSync(filePath, 'utf8');
      let history = JSON.parse(data);
      
      // Convert timestamps to Date objects
      history.forEach(trade => {
        if (trade.timestamp) trade.timestamp = new Date(trade.timestamp);
      });
      
      // Apply filters if provided
      if (filters.strategyId) {
        history = history.filter(trade => trade.strategyId === filters.strategyId);
      }
      
      if (filters.tokenAddress) {
        history = history.filter(trade => trade.tokenAddress === filters.tokenAddress);
      }
      
      if (filters.startDate) {
        const startDate = new Date(filters.startDate);
        history = history.filter(trade => trade.timestamp >= startDate);
      }
      
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        history = history.filter(trade => trade.timestamp <= endDate);
      }
      
      if (filters.success !== undefined) {
        history = history.filter(trade => trade.success === filters.success);
      }
      
      return history;
    } catch (error) {
      logger.error(`Failed to get trading history: ${error.message}`);
      return [];
    }
  }
}

module.exports = new Database(); 