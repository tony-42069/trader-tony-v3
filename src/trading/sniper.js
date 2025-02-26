const { 
  Transaction, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const { Token, u64 } = require('@solana/spl-token');
const logger = require('../utils/logger');
const JupiterClient = require('../utils/jupiter');

/**
 * TokenSniper class for sniping Solana tokens using Jupiter DEX
 */
class TokenSniper {
  constructor(connection, wallet, riskAnalyzer, positionManager) {
    this.connection = connection;
    this.wallet = wallet;
    this.riskAnalyzer = riskAnalyzer;
    this.positionManager = positionManager;
    this.jupiterClient = new JupiterClient(connection);
    
    logger.info('TokenSniper initialized with Jupiter DEX integration');
  }

  /**
   * Snipe a token by purchasing it with SOL
   * @param {string} tokenAddress - Token mint address
   * @param {number} amountInSol - Amount of SOL to spend
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Snipe result
   */
  async snipeToken(tokenAddress, amountInSol, options = {}) {
    try {
      logger.info(`Starting snipe operation for token ${tokenAddress} with ${amountInSol} SOL`);
      
      // Demo mode handling
      if (this.wallet.demoMode) {
        logger.info(`Demo mode: Simulating snipe for token ${tokenAddress} with ${amountInSol} SOL`);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate delay
        
        // Run risk analysis for a realistic demo experience
        const riskResult = await this.riskAnalyzer.analyzeToken(tokenAddress);
        logger.info(`Demo mode: Risk analysis completed with level ${riskResult.riskLevel}%`);
        
        // Generate a fake position ID
        const positionId = `demo_${Date.now().toString()}`;
        
        // Create a simulated position in demo mode
        if (this.positionManager) {
          const demoEntryPrice = 0.0001; // Fake price
          const demoAmount = amountInSol * 1000; // Simulate token amount
          
          this.positionManager.addPosition(
            tokenAddress,
            demoEntryPrice,
            demoAmount,
            {
              stopLoss: options.stopLoss || 20,
              takeProfit: options.takeProfit || 50
            }
          );
        }
        
        return {
          success: true,
          tokenAddress,
          amountInSol,
          signature: `demo_tx_${Date.now().toString(16)}`,
          positionId,
          demoMode: true
        };
      }
      
      // REAL MODE - Production implementation
      
      // 1. Run risk analysis first
      const riskResult = await this.riskAnalyzer.analyzeToken(tokenAddress);
      if (riskResult.riskLevel > (options.maxRisk || 70)) {
        throw new Error(`Token risk too high: ${riskResult.riskLevel}%. ${riskResult.warnings.join(', ')}`);
      }
      
      logger.info(`Risk analysis passed for ${tokenAddress} with level ${riskResult.riskLevel}%`);
      
      // 2. Execute the swap using Jupiter
      const snipeResult = await this.jupiterClient.snipeToken(
        tokenAddress,
        amountInSol,
        this.wallet,
        {
          slippage: options.slippage || 5,
          skipPreflight: options.skipPreflight !== false, // Default to true for sniping
          maxRetries: options.maxRetries || 3
        }
      );
      
      if (!snipeResult.success) {
        throw new Error(`Jupiter swap failed: ${snipeResult.error}`);
      }
      
      logger.info(`Successfully sniped token ${tokenAddress}. Transaction: ${snipeResult.signature}`);
      
      // 3. Create position tracking with stop loss/take profit if requested
      if (this.positionManager && options.trackPosition !== false) {
        try {
          // Get token price for position tracking
          const currentPrice = await this.jupiterClient.getTokenPrice(tokenAddress);
          
          // Estimate token amount from swap output
          const tokenAmount = snipeResult.outAmount || amountInSol * 1000; // Fallback if not available
          
          // Add position to tracking
          const position = this.positionManager.addPosition(
            tokenAddress,
            currentPrice,
            tokenAmount,
            {
              stopLoss: options.stopLoss,
              takeProfit: options.takeProfit,
              trailingStop: options.trailingStop
            }
          );
          
          logger.info(`Created position tracking with ID: ${position.id}`);
          
          // Include position ID in result
          snipeResult.positionId = position.id;
        } catch (positionError) {
          logger.error(`Error setting up position tracking: ${positionError.message}`);
          // We still return success since the swap completed
        }
      }
      
      return {
        success: true,
        tokenAddress,
        amountInSol,
        signature: snipeResult.signature,
        positionId: snipeResult.positionId || snipeResult.signature,
        inAmount: snipeResult.inAmount,
        outAmount: snipeResult.outAmount,
        priceImpact: snipeResult.priceImpactPct
      };
    } catch (error) {
      logger.error(`Snipe operation failed for token ${tokenAddress}: ${error.message}`);
      return {
        success: false,
        tokenAddress,
        error: error.message
      };
    }
  }

  /**
   * Buy a token (similar to snipe but with more user-friendly parameters)
   * @param {string} tokenAddress - Token mint address
   * @param {number} amountInSol - Amount of SOL to spend
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Buy result
   */
  async buyToken(tokenAddress, amountInSol, options = {}) {
    return this.snipeToken(tokenAddress, amountInSol, {
      maxRisk: 50,  // Lower default risk tolerance for regular buys
      slippage: options.slippage || 2, // Lower default slippage
      skipPreflight: false, // Regular buys can use preflight
      ...options
    });
  }

  /**
   * Sell a token
   * @param {string} tokenAddress - Token mint address
   * @param {number} tokenAmount - Amount of tokens to sell
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Sell result
   */
  async sellToken(tokenAddress, tokenAmount, options = {}) {
    try {
      logger.info(`Selling ${tokenAmount} of token ${tokenAddress}`);
      
      // Demo mode handling
      if (this.wallet.demoMode) {
        logger.info(`Demo mode: Simulating sell for ${tokenAmount} of token ${tokenAddress}`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
        
        return {
          success: true,
          tokenAddress,
          tokenAmount,
          amountSol: tokenAmount * 0.0001, // Fake conversion rate
          signature: `demo_tx_${Date.now().toString(16)}`,
          demoMode: true
        };
      }
      
      // Execute the swap using Jupiter (token -> SOL)
      const sellResult = await this.jupiterClient.executeSwap(
        tokenAddress,  // Input is the token
        'SOL',         // Output is SOL
        tokenAmount,   // Amount of tokens to sell
        this.wallet,
        {
          slippage: options.slippage || 2,
          ...options
        }
      );
      
      if (!sellResult.success) {
        throw new Error(`Jupiter swap failed: ${sellResult.error}`);
      }
      
      logger.info(`Successfully sold ${tokenAmount} of token ${tokenAddress}. Transaction: ${sellResult.signature}`);
      
      // If position is being tracked, close it
      if (options.positionId && this.positionManager) {
        try {
          this.positionManager.closePosition(
            options.positionId,
            sellResult.inAmount / sellResult.outAmount, // Approximate exchange rate
            'MANUAL_SELL'
          );
        } catch (positionError) {
          logger.error(`Error closing position: ${positionError.message}`);
        }
      }
      
      return {
        success: true,
        tokenAddress,
        tokenAmount,
        amountSol: sellResult.outAmount / LAMPORTS_PER_SOL,
        signature: sellResult.signature,
        priceImpact: sellResult.priceImpactPct
      };
    } catch (error) {
      logger.error(`Sell operation failed for token ${tokenAddress}: ${error.message}`);
      return {
        success: false,
        tokenAddress,
        error: error.message
      };
    }
  }
}

module.exports = TokenSniper; 