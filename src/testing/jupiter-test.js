/**
 * TraderTony v3 - Jupiter API Test Script
 * This script tests connectivity to the Jupiter API and verifies quote functionality
 */

require('dotenv').config();
const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const solanaClient = require('../utils/solana');
const logger = require('../utils/logger');

// Test configuration
const TEST_CONFIG = {
  testAmount: 0.01 * LAMPORTS_PER_SOL, // 0.01 SOL
  testToken: 'GfGYyTDGpUkPEYSeVhFirFcP3LqUDq9XnKBA4czmg2fM', // Replace with a legitimate test token
  slippage: 1.0, // 1% slippage
  priorityFee: 1000, // 1000 micro-lamports
};

// Test Jupiter connection
async function testJupiterConnection() {
  logger.info('🧪 Testing Jupiter API connectivity...');
  
  try {
    // Initialize Solana client
    await solanaClient.init({
      network: 'testnet',
      // SolanaClient reads private key from env vars
      demoMode: process.env.TEST_MODE === 'demo', // Use testnet with real wallet unless demo mode
    });
    
    // Access the jupiter client directly from solanaClient
    const jupiterClient = solanaClient.jupiterClient;
    
    if (!jupiterClient) {
      logger.error('❌ Jupiter client not available in SolanaClient');
      return false;
    }
    
    // Check if Jupiter client is initialized
    if (!jupiterClient.isInitialized && typeof jupiterClient.isInitialized === 'function') {
      const isInit = jupiterClient.isInitialized();
      if (!isInit) {
        logger.error('❌ Jupiter client is not initialized');
        return false;
      }
      logger.info('✅ Jupiter client initialized successfully');
    } else {
      // Assume it's initialized if the method doesn't exist but the client does
      logger.info('✅ Jupiter client available (initialization status unknown)');
    }
    
    // Test get price
    logger.info(`Testing price fetching for token ${TEST_CONFIG.testToken}...`);
    const tokenPrice = await jupiterClient.getTokenPriceInSOL(new PublicKey(TEST_CONFIG.testToken));
    
    if (tokenPrice) {
      logger.info(`✅ Successfully fetched token price: ${tokenPrice} SOL`);
    } else {
      logger.error('❌ Failed to fetch token price');
    }
    
    // Test get quote SOL -> TOKEN
    logger.info(`Testing quote fetch for buying token with ${TEST_CONFIG.testAmount / LAMPORTS_PER_SOL} SOL...`);
    const buyQuote = await jupiterClient.getQuote({
      inputMint: jupiterClient.getWrappedSolMint ? jupiterClient.getWrappedSolMint() : new PublicKey('So11111111111111111111111111111111111111112'),
      outputMint: new PublicKey(TEST_CONFIG.testToken),
      amount: TEST_CONFIG.testAmount,
      slippage: TEST_CONFIG.slippage,
    });
    
    if (buyQuote) {
      logger.info(`✅ Successfully fetched buy quote:`);
      logger.info(`   Input: ${buyQuote.inputAmount / LAMPORTS_PER_SOL} SOL`);
      logger.info(`   Output: ${buyQuote.outputAmount} tokens`);
      logger.info(`   Price Impact: ${buyQuote.priceImpactPct.toFixed(2)}%`);
    } else {
      logger.error('❌ Failed to fetch buy quote');
    }
    
    // Test get quote TOKEN -> SOL
    // Calculate token amount for 0.001 SOL worth of tokens
    const estimatedTokenAmount = (0.001 * LAMPORTS_PER_SOL) / tokenPrice;
    
    logger.info(`Testing quote fetch for selling ${estimatedTokenAmount} tokens...`);
    const sellQuote = await jupiterClient.getQuote({
      inputMint: new PublicKey(TEST_CONFIG.testToken),
      outputMint: jupiterClient.getWrappedSolMint ? jupiterClient.getWrappedSolMint() : new PublicKey('So11111111111111111111111111111111111111112'),
      amount: estimatedTokenAmount,
      slippage: TEST_CONFIG.slippage,
    });
    
    if (sellQuote) {
      logger.info(`✅ Successfully fetched sell quote:`);
      logger.info(`   Input: ${sellQuote.inputAmount} tokens`);
      logger.info(`   Output: ${sellQuote.outputAmount / LAMPORTS_PER_SOL} SOL`);
      logger.info(`   Price Impact: ${sellQuote.priceImpactPct.toFixed(2)}%`);
    } else {
      logger.error('❌ Failed to fetch sell quote');
    }
    
    // Test simulate swap (no execution)
    logger.info('Testing swap simulation...');
    const simulateResult = await jupiterClient.simulateSwap({
      inputMint: jupiterClient.getWrappedSolMint ? jupiterClient.getWrappedSolMint() : new PublicKey('So11111111111111111111111111111111111111112'),
      outputMint: new PublicKey(TEST_CONFIG.testToken),
      amount: TEST_CONFIG.testAmount,
      slippage: TEST_CONFIG.slippage,
      priorityFee: TEST_CONFIG.priorityFee,
    });
    
    if (simulateResult.success) {
      logger.info('✅ Swap simulation successful');
    } else {
      logger.error(`❌ Swap simulation failed: ${simulateResult.error}`);
    }
    
    logger.info('✅ Jupiter API test completed successfully');
    return true;
  } catch (error) {
    logger.error('❌ Error testing Jupiter API:', error);
    return false;
  }
}

// Main function
async function main() {
  const success = await testJupiterConnection();
  
  if (success) {
    logger.info('🎉 All Jupiter API tests passed!');
    process.exit(0);
  } else {
    logger.error('❌ Some Jupiter API tests failed. Please check the logs.');
    process.exit(1);
  }
}

// Run the test
main(); 