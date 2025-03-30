/**
 * TraderTony v3 - Testnet Preparation Script
 * This script prepares the testnet environment for comprehensive testing
 * 
 * Functions:
 * 1. Ensure sufficient SOL balance in test wallet
 * 2. Check for and obtain test tokens
 * 3. Verify Jupiter API connectivity
 * 4. Set up test database entries
 */

require('dotenv').config();
const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const solanaClient = require('../utils/solana');
const logger = require('../utils/logger');

// Test configuration
const TEST_CONFIG = {
  // Minimum SOL balance needed for testing
  minSolBalance: 0.5, // 0.5 SOL
  
  // Test tokens to verify
  testTokens: [
    'GfGYyTDGpUkPEYSeVhFirFcP3LqUDq9XnKBA4czmg2fM', // Example token - replace with actual test token
  ],
  
  // Position database reset
  resetPositions: true, // Set to true to clear positions.json for fresh tests
};

// Verify SOL balance
async function checkSolBalance() {
  logger.info('Checking SOL balance...');
  
  try {
    // Use SolanaClient's walletManager
    const walletAddress = solanaClient.getWalletAddress();
    
    // In demo mode or real mode, get balance
    let balance;
    if (solanaClient.demoMode) {
      // Demo mode: get balance of demo wallet
      balance = await solanaClient.connection.getBalance(new PublicKey(walletAddress));
    } else {
      // Real mode: get balance via wallet manager
      balance = await solanaClient.walletManager.getBalance();
    }
    
    const solBalance = balance / LAMPORTS_PER_SOL;
    
    logger.info(`Current SOL balance: ${solBalance.toFixed(4)} SOL`);
    
    if (solBalance < TEST_CONFIG.minSolBalance) {
      logger.warn(`⚠️ SOL balance is below the minimum required (${TEST_CONFIG.minSolBalance} SOL)`);
      logger.info('Please fund your testnet wallet with SOL from a faucet:');
      logger.info('1. https://faucet.solana.com/');
      logger.info('2. https://solfaucet.com/');
      logger.info(`Your wallet address: ${walletAddress}`);
      return false;
    }
    
    logger.info('✅ SOL balance is sufficient for testing');
    return true;
  } catch (error) {
    logger.error('Error checking SOL balance:', error);
    return false;
  }
}

// Verify test tokens
async function verifyTestTokens() {
  logger.info('Verifying test tokens...');
  
  try {
    // Access connection directly from solanaClient
    const connection = solanaClient.connection;
    const walletAddress = solanaClient.getWalletAddress();
    
    for (const tokenAddress of TEST_CONFIG.testTokens) {
      logger.info(`Checking token ${tokenAddress}...`);
      
      try {
        // Get token accounts for this mint owned by our wallet
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          new PublicKey(walletAddress),
          { mint: new PublicKey(tokenAddress) }
        );
        
        if (tokenAccounts.value.length > 0) {
          const tokenAccount = tokenAccounts.value[0];
          const balance = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;
          
          logger.info(`✅ Found token ${tokenAddress} with balance: ${balance}`);
        } else {
          logger.warn(`⚠️ Token ${tokenAddress} is not in wallet yet`);
          
          // Check if token exists on blockchain
          try {
            const tokenInfo = await connection.getTokenSupply(new PublicKey(tokenAddress));
            logger.info(`✅ Token exists. Supply: ${tokenInfo.value.uiAmount}`);
          } catch (e) {
            logger.error(`❌ Token ${tokenAddress} doesn't appear to exist or is not an SPL token`);
            return false;
          }
        }
      } catch (error) {
        logger.error(`Error verifying token ${tokenAddress}:`, error);
        return false;
      }
    }
    
    logger.info('✅ Test tokens verified');
    return true;
  } catch (error) {
    logger.error('Error verifying test tokens:', error);
    return false;
  }
}

// Reset positions database for fresh tests
async function resetPositionsDatabase() {
  if (!TEST_CONFIG.resetPositions) {
    logger.info('Skipping positions database reset');
    return true;
  }
  
  logger.info('Resetting positions database for fresh tests...');
  
  try {
    // Path to positions.json
    const positionsPath = path.join(__dirname, '..', '..', 'data', 'positions.json');
    
    // Check if file exists
    if (fs.existsSync(positionsPath)) {
      // Back up current file
      const backupPath = path.join(__dirname, '..', '..', 'data', `positions-backup-${Date.now()}.json`);
      fs.copyFileSync(positionsPath, backupPath);
      logger.info(`Backed up positions to ${backupPath}`);
      
      // Create empty positions file
      fs.writeFileSync(positionsPath, JSON.stringify({ positions: [] }, null, 2));
      logger.info('✅ Positions database reset successfully');
    } else {
      // Create directory if it doesn't exist
      const dataDir = path.join(__dirname, '..', '..', 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      // Create empty positions file
      fs.writeFileSync(positionsPath, JSON.stringify({ positions: [] }, null, 2));
      logger.info('✅ Created new empty positions database');
    }
    
    return true;
  } catch (error) {
    logger.error('Error resetting positions database:', error);
    return false;
  }
}

// Test Jupiter API connectivity
async function testJupiterConnectivity() {
  logger.info('Testing Jupiter API connectivity...');
  
  try {
    // Access Jupiter client directly from solanaClient
    const jupiterClient = solanaClient.jupiterClient;
    
    if (!jupiterClient || !jupiterClient.isInitialized) {
      logger.error('❌ Jupiter client is not initialized');
      return false;
    }
    
    // Test get price for SOL (wrapped SOL to USDC)
    const solPrice = await jupiterClient.getSOLPrice();
    
    if (solPrice) {
      logger.info(`✅ Successfully fetched SOL price: $${solPrice}`);
    } else {
      logger.error('❌ Failed to fetch SOL price');
      return false;
    }
    
    // Test get price for test token
    if (TEST_CONFIG.testTokens.length > 0) {
      const testToken = TEST_CONFIG.testTokens[0];
      const tokenPrice = await jupiterClient.getTokenPrice(new PublicKey(testToken));
      
      if (tokenPrice) {
        logger.info(`✅ Successfully fetched token price: $${tokenPrice}`);
      } else {
        logger.warn(`⚠️ Unable to fetch price for test token ${testToken}`);
        // Not returning false as this is not critical
      }
    }
    
    logger.info('✅ Jupiter API connectivity test passed');
    return true;
  } catch (error) {
    logger.error('Error testing Jupiter API connectivity:', error);
    return false;
  }
}

// Main function
async function main() {
  logger.info('🧪 Starting Testnet Preparation...');
  
  try {
    // Initialize Solana client with the correct privateKey parameter name
    await solanaClient.init({
      network: 'testnet',
      // Note: SolanaClient expects SOLANA_PRIVATE_KEY from env, not passed directly
      demoMode: false, // Use real testnet mode for preparation
    });
    
    logger.info('✅ Solana client initialized successfully');
    
    // Check SOL balance
    const solBalanceOk = await checkSolBalance();
    if (!solBalanceOk) {
      logger.warn('⚠️ SOL balance check failed. Please fund your testnet wallet.');
    }
    
    // Verify test tokens
    const testTokensOk = await verifyTestTokens();
    if (!testTokensOk) {
      logger.warn('⚠️ Test token verification failed. Some tokens may not be available.');
    }
    
    // Test Jupiter API connectivity
    const jupiterConnectivityOk = await testJupiterConnectivity();
    if (!jupiterConnectivityOk) {
      logger.error('❌ Jupiter API connectivity test failed. Testing may not work correctly.');
    }
    
    // Reset positions database
    const resetPositionsOk = await resetPositionsDatabase();
    if (!resetPositionsOk) {
      logger.error('❌ Failed to reset positions database.');
    }
    
    // Final assessment
    if (solBalanceOk && testTokensOk && jupiterConnectivityOk && resetPositionsOk) {
      logger.info('✅ Testnet preparation completed successfully. Ready for testing!');
      logger.info('Run test scripts in src/testing/ directory to test individual features.');
      process.exit(0);
    } else {
      logger.warn('⚠️ Testnet preparation completed with some warnings or errors.');
      logger.info('Review the logs above and address any issues before proceeding with tests.');
      process.exit(1);
    }
  } catch (error) {
    logger.error('Error during testnet preparation:', error);
    process.exit(1);
  }
}

// Run the preparation
main(); 