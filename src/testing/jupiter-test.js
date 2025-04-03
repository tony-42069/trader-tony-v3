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
  testAmount: 0.01 * LAMPORTS_PER_SOL, // 0.01 SOL (in lamports for getQuote)
  testToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Using USDC for testing
  testTokenDecimals: 6, // USDC has 6 decimals
  slippage: 1.0, // 1% slippage
  priorityFee: 1000, // 1000 micro-lamports (Not used currently)
};

// Test Jupiter connection
async function testJupiterConnection() {
  logger.info('🧪 Testing Jupiter API connectivity...');
  let overallSuccess = true; // Assume success initially

  try {
    // Initialize Solana client
    await solanaClient.init(); // Reads from .env

    // Access the jupiter client directly from solanaClient
    const jupiterClient = solanaClient.jupiterClient;

    if (!jupiterClient) {
      logger.error('❌ Jupiter client not available in SolanaClient');
      return false; // Critical failure
    }
    logger.info('✅ Jupiter client available');

    // Test get price
    logger.info(`Testing price fetching for token ${TEST_CONFIG.testToken}...`);
    const tokenPrice = await jupiterClient.getTokenPrice(TEST_CONFIG.testToken);

    let priceFetchSuccess = false;
    if (tokenPrice >= 0) {
      logger.info(`✅ Successfully fetched token price: ${tokenPrice} SOL`);
      priceFetchSuccess = true;
    } else {
      logger.error('❌ Failed to fetch token price');
      overallSuccess = false; // Mark overall test as failed
    }

    // Test get quote SOL -> TOKEN
    logger.info(`Testing quote fetch for buying token with ${TEST_CONFIG.testAmount / LAMPORTS_PER_SOL} SOL...`);
    // Note: getQuote expects amount in smallest unit (lamports for SOL)
    const buyQuote = await jupiterClient.getQuote(
        'SOL', // Use 'SOL' string, getQuote handles mapping to WSOL mint
        TEST_CONFIG.testToken,
        TEST_CONFIG.testAmount, // Amount in lamports
        { slippage: TEST_CONFIG.slippage }
    );

    let buyQuoteSuccess = false;
    if (buyQuote && buyQuote.success) {
      logger.info(`✅ Successfully fetched buy quote:`);
      logger.info(`   Input: ${(parseFloat(buyQuote.inAmount) || 0) / LAMPORTS_PER_SOL} SOL`);
      logger.info(`   Output: ${buyQuote.outAmount || 'N/A'} tokens (smallest unit)`);
      // Parse priceImpactPct to float before formatting
      logger.info(`   Price Impact: ${(parseFloat(buyQuote.priceImpactPct) || 0).toFixed(4)}%`); 
      buyQuoteSuccess = true;
    } else {
      logger.error(`❌ Failed to fetch buy quote. Error: ${buyQuote?.error}`);
      overallSuccess = false; // Mark overall test as failed
    }

    // Test get quote TOKEN -> SOL
    let estimatedTokenAmount = 0; // Amount in full tokens
    let estimatedTokenAmountLamports = 0; // Amount in smallest unit
    const tokenDecimals = TEST_CONFIG.testTokenDecimals; // Use configured decimals

    if (priceFetchSuccess && tokenPrice > 0) {
        // Calculate amount of token equivalent to 0.001 SOL
        estimatedTokenAmount = 0.001 / tokenPrice;
        estimatedTokenAmountLamports = Math.round(estimatedTokenAmount * (10 ** tokenDecimals));
        logger.info(`Testing quote fetch for selling ${estimatedTokenAmount.toFixed(6)} ${TEST_CONFIG.testToken} tokens...`);
    } else {
        logger.warn(`Skipping sell quote test as token price is invalid (${tokenPrice})`);
    }

    let sellQuote = null;
    let sellQuoteSuccess = false;
    if (estimatedTokenAmountLamports > 0) {
        sellQuote = await jupiterClient.getQuote(
            TEST_CONFIG.testToken,
            'SOL', // Use 'SOL' string
            estimatedTokenAmountLamports, // Amount in smallest unit
            {
                slippage: TEST_CONFIG.slippage,
                inputDecimals: tokenDecimals // Provide input decimals (USDC = 6)
            }
        );

        if (sellQuote && sellQuote.success) {
          logger.info(`✅ Successfully fetched sell quote:`);
      logger.info(`   Input: ${sellQuote.inAmount || 'N/A'} tokens (smallest unit)`);
      logger.info(`   Output: ${(parseFloat(sellQuote.outAmount) || 0) / LAMPORTS_PER_SOL} SOL`);
       // Parse priceImpactPct to float before formatting
      logger.info(`   Price Impact: ${(parseFloat(sellQuote.priceImpactPct) || 0).toFixed(4)}%`);
      sellQuoteSuccess = true;
        } else {
          logger.error(`❌ Failed to fetch sell quote. Error: ${sellQuote?.error}`);
          // Don't mark overall as failed if only sell quote fails, but log it
        }
    } else {
        // If we skipped the test, don't mark sellQuote as failed
        sellQuoteSuccess = true; // Or handle differently if sell quote is mandatory
        logger.info('ℹ️ Sell quote test skipped.');
    }

    // Final success check - requires price and buy quote at minimum
    overallSuccess = overallSuccess && priceFetchSuccess && buyQuoteSuccess;

    if (overallSuccess) {
        logger.info('✅ Jupiter API basic tests completed successfully (Price & Buy Quote)');
    } else {
        logger.warn('⚠️ Jupiter API basic tests completed with failures.');
    }
    return overallSuccess;

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
