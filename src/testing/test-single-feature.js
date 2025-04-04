/**
 * TraderTony v3 - Single Feature Test Script
 * Use this script to test a single position management feature in isolation
 * 
 * Usage:
 * node src/testing/test-single-feature.js stopLoss
 * node src/testing/test-single-feature.js takeProfit
 * node src/testing/test-single-feature.js partialProfit
 * node src/testing/test-single-feature.js trailingStop
 * node src/testing/test-single-feature.js maxHoldTime
 * node src/testing/test-single-feature.js scaleIn
 */

// Force reload of modules to attempt to bypass caching issues
Object.keys(require.cache).forEach(key => delete require.cache[key]);
console.log("--- Cleared Node.js module cache ---"); // Add log to confirm execution

require('dotenv').config();
const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const solanaClient = require('../utils/solana');
const logger = require('../utils/logger');
const AutoTrader = require('../trading/auto-trader');

// Default test configuration
const TEST_CONFIG = {
  // Test tokens (use testnet tokens)
  testTokenAddress: 'BRwUd4UdV9a9q3tW1F8KPw6s7p9VuWN3LFmQ7RqPHUgu', // Using suggested Testnet USDC
  
  // Position sizes for tests
  testPositionSizeSOL: 0.05, // Small test amount (0.05 SOL)
  
  // Test parameters
  stopLossPercent: 5, // 5% stop loss
  takeProfitPercent: 10, // 10% take profit
  trailingStopPercent: 15, // Start trailing at 15% profit
  trailingStopDistance: 5, // 5% distance for trailing stop
  maxHoldTimeMinutes: 5, // 5 minutes for testing
  
  // Partial taking profit levels
  partialProfitLevels: [
    { percent: 8, amountPercent: 25 }, // Sell 25% at 8% profit
    { percent: 15, amountPercent: 25 }, // Sell 25% at 15% profit
    { percent: 25, amountPercent: 25 }, // Sell 25% at 25% profit
  ],
  
  // Scale-in configuration
  scaleInConfig: {
    enabled: true,
    phases: [
      { buyAtPercentDrop: 5, positionSizePercent: 30 },  // Buy 30% more at 5% drop
      { buyAtPercentDrop: 15, positionSizePercent: 30 }  // Buy 30% more at 15% drop
    ]
  }
};

// Create a test position for specified feature
async function createTestPosition(featureType) {
  logger.info(`Creating test position for ${featureType} feature test`);
  
  try {
    await solanaClient.init({
      network: 'testnet',
      // SolanaClient reads private key from env vars
      demoMode: process.env.TEST_MODE === 'demo', // Use testnet with real wallet unless demo mode
    });
    
    // Get position manager and auto trader
    const positionManager = solanaClient.positionManager;
    
    // Create or get auto trader instance
    let autoTrader;
    if (solanaClient.tokenSniper && solanaClient.tokenSniper.autoTrader) {
      autoTrader = solanaClient.tokenSniper.autoTrader;
    } else {
      // Instantiate AutoTrader, passing all required components from solanaClient
      autoTrader = new AutoTrader(
        solanaClient.connection, 
        solanaClient.walletManager, 
        solanaClient.tokenSniper,     // Pass tokenSniper
        positionManager, 
        solanaClient.riskAnalyzer,    // Pass riskAnalyzer
        solanaClient.jupiterClient    // Pass jupiterClient
      );
    }
    
    // Create position with appropriate settings for this feature test
    let testSettings = {};
    
    // Configure test-specific settings
    switch(featureType) {
      case 'stopLoss':
        testSettings = {
          stopLossPercent: TEST_CONFIG.stopLossPercent,
          takeProfitPercent: 100, // Set high to not trigger
          trailingStopEnabled: false,
          maxHoldTime: 60 * 60 * 24, // 24 hours
          partialProfitEnabled: false
        };
        break;
        
      case 'takeProfit':
        testSettings = {
          stopLossPercent: 50, // Set low to not trigger
          takeProfitPercent: TEST_CONFIG.takeProfitPercent,
          trailingStopEnabled: false,
          maxHoldTime: 60 * 60 * 24, // 24 hours
          partialProfitEnabled: false
        };
        break;
        
      case 'partialProfit':
        testSettings = {
          stopLossPercent: 50, // Set low to not trigger
          takeProfitPercent: 100, // Set high to not trigger
          trailingStopEnabled: false,
          maxHoldTime: 60 * 60 * 24, // 24 hours
          partialProfitEnabled: true,
          partialProfitLevels: TEST_CONFIG.partialProfitLevels
        };
        break;
        
      case 'trailingStop':
        testSettings = {
          stopLossPercent: 50, // Set low to not trigger
          takeProfitPercent: 100, // Set high to not trigger
          trailingStopEnabled: true,
          trailingStopTriggerPercent: TEST_CONFIG.trailingStopPercent,
          trailingStopDistancePercent: TEST_CONFIG.trailingStopDistance,
          maxHoldTime: 60 * 60 * 24, // 24 hours
          partialProfitEnabled: false
        };
        break;
        
      case 'maxHoldTime':
        testSettings = {
          stopLossPercent: 50, // Set low to not trigger
          takeProfitPercent: 100, // Set high to not trigger
          trailingStopEnabled: false,
          maxHoldTime: TEST_CONFIG.maxHoldTimeMinutes * 60, // Convert to seconds
          partialProfitEnabled: false
        };
        break;
        
      case 'scaleIn':
        testSettings = {
          stopLossPercent: 50, // Set low to not trigger
          takeProfitPercent: 100, // Set high to not trigger
          trailingStopEnabled: false,
          maxHoldTime: 60 * 60 * 24, // 24 hours
          partialProfitEnabled: false,
          scaleInEnabled: true,
          scaleInPhases: TEST_CONFIG.scaleInConfig.phases
        };
        break;
        
      default:
        logger.error(`Unknown feature type: ${featureType}`);
        logger.info('Available types: stopLoss, takeProfit, partialProfit, trailingStop, maxHoldTime, scaleIn');
        process.exit(1);
    }
    
    // Create a strategy with appropriate settings
    const testStrategy = {
      name: `TestStrategy_${featureType}`,
      config: testSettings
    };
    
    // Create a mock opportunity
    const opportunity = {
      tokenAddress: TEST_CONFIG.testTokenAddress,
      tokenSymbol: 'TEST',
      tokenName: 'Test Token',
      confidence: 0.95,
      strategy: testStrategy,
      executionPlan: {
        initialBuyPercent: 40,
        scaleInEnabled: featureType === 'scaleIn',
        scaleInPhases: featureType === 'scaleIn' ? TEST_CONFIG.scaleInConfig.phases : []
      }
    };
    
    // Fetch current price for the test token
    // --- DIRECT FIX START ---
    let currentPrice;
    const wsolAddress = "So11111111111111111111111111111111111111112";
    if (TEST_CONFIG.testTokenAddress === wsolAddress) {
      logger.info("[TEST SCRIPT] Test token is WSOL, using fixed price of 1.0");
      currentPrice = 1.0;
    } else {
      logger.info(`[TEST SCRIPT] Test token is not WSOL (${TEST_CONFIG.testTokenAddress}), calling getTokenPrice...`);
      currentPrice = await solanaClient.jupiterClient.getTokenPrice(TEST_CONFIG.testTokenAddress);
    }
    // --- DIRECT FIX END ---
    if (currentPrice <= 0) { // Check for <= 0 for robustness
        throw new Error(`Failed to fetch price for test token ${TEST_CONFIG.testTokenAddress} (Price: ${currentPrice})`);
    }
    
    // Construct the required tokenMetadata object
    const tokenMetadata = {
        address: opportunity.tokenAddress,
        symbol: opportunity.tokenSymbol, // Include for potential use in addPosition
        name: opportunity.tokenName,     // Include for potential use in addPosition
        price: currentPrice              // Add the fetched price
        // Add other metadata fields if executeBuy or addPosition requires them
    };

    // Execute the buy with correct arguments: tokenMetadata and strategy
    // Note: The actual buy amount is determined within executeBuy based on strategy config
    const result = await autoTrader.executeBuy(
      tokenMetadata, 
      testStrategy 
    );
    
    if (result.success) {
      logger.info(`✅ Test position for ${featureType} created successfully: ${result.txSignature}`);
      logger.info(`Position ID: ${result.positionId}`);
      return result.positionId;
    } else {
      logger.error(`❌ Failed to create test position for ${featureType}: ${result.error}`);
      return null;
    }
  } catch (error) {
    logger.error(`❌ Error creating test position for ${featureType}:`, error);
    return null;
  }
}

// Monitor position status
async function monitorPosition(positionId) {
  logger.info(`Monitoring position ${positionId}...`);
  
  // Get position manager
  const positionManager = solanaClient.positionManager;
  
  if (!positionManager) {
    logger.error('❌ Position manager not initialized! Cannot monitor position.');
    return;
  }
  
  // Add enhanced logging
  const originalProcessPosition = positionManager.processPosition;
  positionManager.processPosition = async function(position) {
    if (position.id === positionId) {
      logger.info(`[TEST] Processing position ${position.id}:`);
      logger.info(`  Current Price: ${position.currentPrice}`);
      logger.info(`  Entry Price: ${position.entryPrice}`);
      logger.info(`  P/L: ${position.profitPercent.toFixed(2)}%`);
      
      if (position.stopLossPrice) {
        logger.info(`  Stop Loss: ${position.stopLossPrice} (${position.stopLossPercent}%)`);
      }
      
      if (position.takeProfitPrice) {
        logger.info(`  Take Profit: ${position.takeProfitPrice} (${position.takeProfitPercent}%)`);
      }
      
      if (position.trailingStopEnabled && position.highestPrice) {
        logger.info(`  Trailing Stop: Active at ${position.highestPrice * (1 - position.trailingStopDistancePercent/100)}`);
        logger.info(`    Highest Price: ${position.highestPrice}`);
        logger.info(`    Trigger: ${position.trailingStopTriggerPercent}%`);
        logger.info(`    Distance: ${position.trailingStopDistancePercent}%`);
      }
      
      if (position.partialProfitEnabled && position.partialProfitLevels) {
        logger.info(`  Partial Profit Levels: ${JSON.stringify(position.partialProfitLevels)}`);
        logger.info(`  Sold Levels: ${JSON.stringify(position.soldProfitLevels || [])}`);
      }
      
      if (position.maxHoldTime) {
        const timeHeld = (Date.now() - position.entryTimestamp) / 1000;
        const timeRemaining = position.maxHoldTime - timeHeld;
        logger.info(`  Max Hold Time: ${timeRemaining.toFixed(0)}s remaining`);
      }
      
      if (position.scaleInEnabled) {
        logger.info(`  Scale-In Phases: ${JSON.stringify(position.scaleInPhases)}`);
        logger.info(`  Executed Phases: ${JSON.stringify(position.executedScaleInPhases || [])}`);
      }
    }
    
    return await originalProcessPosition.call(this, position);
  };
  
  // Keep monitoring until position is closed
  logger.info('⚠️ Keep this window open to monitor the test position.');
  logger.info('Press Ctrl+C to stop monitoring (but position management will continue).');
  
  // Check status every 10 seconds
  const checkInterval = setInterval(() => {
    // Access positions directly from position manager
    const positions = positionManager.getPositions ? 
                      positionManager.getPositions() : 
                      positionManager.positions || [];
                      
    const position = positions.find(p => p.id === positionId);
    
    if (!position) {
      logger.info(`🏁 Position ${positionId} has been closed. Test complete!`);
      clearInterval(checkInterval);
      process.exit(0);
    }
  }, 10000);
}

// Main function
async function main() {
  // Get feature type from command line
  const featureType = process.argv[2];
  
  if (!featureType) {
    logger.error('Please specify a feature to test');
    logger.info('Usage: node src/testing/test-single-feature.js [featureType]');
    logger.info('Available types: stopLoss, takeProfit, partialProfit, trailingStop, maxHoldTime, scaleIn');
    process.exit(1);
  }
  
  // Create and monitor test position
  const positionId = await createTestPosition(featureType);
  
  if (positionId) {
    await monitorPosition(positionId);
  } else {
    logger.error('Failed to create test position. Exiting.');
    process.exit(1);
  }
}

// Run the test
main();
