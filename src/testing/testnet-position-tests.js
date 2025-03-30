/**
 * TraderTony v3 - Testnet Position Management Tests
 * This script tests various position management features on testnet
 */

require('dotenv').config();
const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const solanaClient = require('../utils/solana');
const logger = require('../utils/logger');

// Test configuration
const TEST_CONFIG = {
  // Set to true to run this specific test
  runStopLossTest: true,
  runTakeProfitTest: true,
  runPartialProfitTest: true,
  runTrailingStopTest: true,
  runMaxHoldTimeTest: true,
  runScaleInTest: true,
  
  // Test tokens (use testnet tokens)
  testTokenAddress: 'GfGYyTDGpUkPEYSeVhFirFcP3LqUDq9XnKBA4czmg2fM', // Replace with your test token for testnet
  
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

// Wait function
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Create a mock position for testing
async function createTestPosition(type) {
  logger.info(`Creating test position for ${type} test`);
  
  try {
    await solanaClient.init({
      network: 'testnet',
      privateKey: process.env.WALLET_PRIVATE_KEY,
      demoMode: false, // Use testnet with a real wallet
    });
    
    // Get token metadata
    const positionManager = solanaClient.getPositionManager();
    const autoTrader = solanaClient.getAutoTrader();
    
    // Create a position with the appropriate settings for this test
    let testSettings = {};
    
    // Configure test-specific settings
    switch(type) {
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
    }
    
    // Create a strategy with appropriate settings
    const testStrategy = {
      name: `TestStrategy_${type}`,
      config: testSettings
    };
    
    // Create a mock opportunty
    const opportunity = {
      tokenAddress: TEST_CONFIG.testTokenAddress,
      tokenSymbol: 'TEST',
      tokenName: 'Test Token',
      confidence: 0.95,
      strategy: testStrategy,
      executionPlan: {
        initialBuyPercent: 40,
        scaleInEnabled: type === 'scaleIn',
        scaleInPhases: type === 'scaleIn' ? TEST_CONFIG.scaleInConfig.phases : []
      }
    };
    
    // Execute the buy (reduced amount for testing)
    const result = await autoTrader.executeBuy(
      opportunity,
      TEST_CONFIG.testPositionSizeSOL * LAMPORTS_PER_SOL // Convert to lamports
    );
    
    if (result.success) {
      logger.info(`✅ Test position for ${type} created successfully: ${result.txSignature}`);
      logger.info(`Position ID: ${result.positionId}`);
      return result.positionId;
    } else {
      logger.error(`❌ Failed to create test position for ${type}: ${result.error}`);
      return null;
    }
  } catch (error) {
    logger.error(`❌ Error creating test position for ${type}:`, error);
    return null;
  }
}

// Run tests
async function runTests() {
  logger.info('🧪 Starting Testnet Position Management Tests');
  
  try {
    // Initialize Solana client
    await solanaClient.init({
      network: 'testnet',
      privateKey: process.env.WALLET_PRIVATE_KEY,
      demoMode: false, // Use testnet with a real wallet
    });
    
    // Set up extra logging for tests
    const positionManager = solanaClient.getPositionManager();
    const originalProcessPosition = positionManager.processPosition;
    
    // Enhance position manager with extra logging
    positionManager.processPosition = async function(position) {
      logger.info(`[TEST] Processing position ${position.id}: currentPrice=${position.currentPrice}, entryPrice=${position.entryPrice}, profit=${position.profitPercent}%`);
      
      if (position.stopLossPrice) {
        logger.info(`[TEST] StopLoss: ${position.stopLossPrice} (${position.stopLossPercent}%)`);
      }
      
      if (position.takeProfitPrice) {
        logger.info(`[TEST] TakeProfit: ${position.takeProfitPrice} (${position.takeProfitPercent}%)`);
      }
      
      if (position.trailingStopEnabled && position.highestPrice) {
        logger.info(`[TEST] TrailingStop: highestPrice=${position.highestPrice}, trigger=${position.trailingStopTriggerPercent}%, distance=${position.trailingStopDistancePercent}%`);
      }
      
      if (position.partialProfitEnabled && position.partialProfitLevels) {
        logger.info(`[TEST] PartialProfit: levels=${JSON.stringify(position.partialProfitLevels)}, soldLevels=${JSON.stringify(position.soldProfitLevels || [])}`);
      }
      
      if (position.maxHoldTime) {
        const timeHeld = (Date.now() - position.entryTimestamp) / 1000;
        const timeRemaining = position.maxHoldTime - timeHeld;
        logger.info(`[TEST] MaxHoldTime: ${position.maxHoldTime}s, timeHeld=${timeHeld.toFixed(0)}s, remaining=${timeRemaining.toFixed(0)}s`);
      }
      
      if (position.scaleInEnabled) {
        logger.info(`[TEST] ScaleIn: phases=${JSON.stringify(position.scaleInPhases)}, executedPhases=${JSON.stringify(position.executedScaleInPhases || [])}`);
      }
      
      return await originalProcessPosition.call(this, position);
    };
    
    // Run the selected tests
    if (TEST_CONFIG.runStopLossTest) {
      logger.info('🧪 Running Stop Loss Test');
      const positionId = await createTestPosition('stopLoss');
      if (positionId) {
        logger.info(`✅ Stop Loss Test position created. Monitor logs to see when it triggers.`);
      }
    }
    
    if (TEST_CONFIG.runTakeProfitTest) {
      logger.info('🧪 Running Take Profit Test');
      const positionId = await createTestPosition('takeProfit');
      if (positionId) {
        logger.info(`✅ Take Profit Test position created. Monitor logs to see when it triggers.`);
      }
    }
    
    if (TEST_CONFIG.runPartialProfitTest) {
      logger.info('🧪 Running Partial Profit Test');
      const positionId = await createTestPosition('partialProfit');
      if (positionId) {
        logger.info(`✅ Partial Profit Test position created. Monitor logs to see when it triggers.`);
      }
    }
    
    if (TEST_CONFIG.runTrailingStopTest) {
      logger.info('🧪 Running Trailing Stop Test');
      const positionId = await createTestPosition('trailingStop');
      if (positionId) {
        logger.info(`✅ Trailing Stop Test position created. Monitor logs to see when it triggers.`);
      }
    }
    
    if (TEST_CONFIG.runMaxHoldTimeTest) {
      logger.info('🧪 Running Max Hold Time Test');
      const positionId = await createTestPosition('maxHoldTime');
      if (positionId) {
        logger.info(`✅ Max Hold Time Test position created. Will auto-sell in ${TEST_CONFIG.maxHoldTimeMinutes} minutes.`);
      }
    }
    
    if (TEST_CONFIG.runScaleInTest) {
      logger.info('🧪 Running Scale-In Test');
      const positionId = await createTestPosition('scaleIn');
      if (positionId) {
        logger.info(`✅ Scale-In Test position created. Monitor logs to see when additional buys trigger.`);
      }
    }
    
    logger.info('🧪 All test positions created. Monitoring for events...');
    
    // Keep script running to monitor positions
    logger.info('⚠️ Keep this window open to monitor test positions. Press Ctrl+C to stop monitoring.');
    
    // Check status every 30 seconds
    const checkInterval = setInterval(() => {
      const positions = positionManager.getPositions();
      logger.info(`Current positions: ${positions.length}`);
      
      if (positions.length === 0) {
        logger.info('🏁 All test positions have been closed. Tests complete!');
        clearInterval(checkInterval);
        process.exit(0);
      }
    }, 30000);
    
  } catch (error) {
    logger.error('❌ Error running testnet tests:', error);
  }
}

// Run the tests
runTests(); 