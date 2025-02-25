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
      const positionsArray = Array.from(positions.values());
      const filePath = path.join(this.dataDir, 'positions.json');
      
      fs.writeFileSync(
        filePath,
        JSON.stringify(positionsArray, null, 2)
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
      const positionsArray = JSON.parse(data);
      
      // Create a new map from the array
      const positions = new Map();
      positionsArray.forEach(position => {
        // Restore Date objects which were serialized as strings
        if (position.createdAt) position.createdAt = new Date(position.createdAt);
        if (position.closedAt) position.closedAt = new Date(position.closedAt);
        
        positions.set(position.id, position);
      });
      
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
}

module.exports = new Database(); 