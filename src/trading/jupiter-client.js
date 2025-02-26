const axios = require('axios');
const { 
  PublicKey, 
  Transaction, 
  VersionedTransaction, 
  TransactionMessage,
  Connection,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const logger = require('../utils/logger');

/**
 * JupiterClient - A utility class for interacting with Jupiter DEX API v6
 * This allows for real trading operations on the Solana blockchain
 */
class JupiterClient {
  constructor(connection) {
    this.connection = connection;
    this.apiBaseUrl = 'https://quote-api.jup.ag/v6';
    
    // Common token mints
    this.SOL_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
    this.USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
    
    logger.info('Jupiter DEX client initialized');
  }

  /**
   * Gets a quote for swapping inputToken to outputToken
   * @param {string} inputMint - Input token mint address (or 'SOL' for native SOL)
   * @param {string} outputMint - Output token mint address (or 'SOL' for native SOL)
   * @param {number} amount - Amount in input token (or SOL)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} The quote result
   */
  async getQuote(inputMint, outputMint, amount, options = {}) {
    try {
      // Handle SOL as special case
      if (inputMint === 'SOL') inputMint = this.SOL_MINT;
      if (outputMint === 'SOL') outputMint = this.SOL_MINT;
      
      // Convert amount to proper format
      const inputDecimals = inputMint === this.SOL_MINT ? 9 : 
                           (options.inputDecimals || 9);
      const inputAmount = inputMint === this.SOL_MINT ? 
                        Math.round(amount * LAMPORTS_PER_SOL) : 
                        Math.round(amount * (10 ** inputDecimals));
      
      const params = {
        inputMint,
        outputMint,
        amount: inputAmount.toString(),
        slippageBps: options.slippage ? Math.round(options.slippage * 100) : 50, // Convert percentage to basis points
        onlyDirectRoutes: options.onlyDirectRoutes || false,
        asLegacyTransaction: !options.useVersionedTransaction,
      };
      
      logger.debug(`Requesting Jupiter quote: ${JSON.stringify(params)}`);
      
      const response = await axios.get(`${this.apiBaseUrl}/quote`, { params });
      
      logger.debug(`Jupiter quote received: ${JSON.stringify({
        inAmount: response.data.inAmount,
        outAmount: response.data.outAmount,
        priceImpactPct: response.data.priceImpactPct
      })}`);
      
      return {
        success: true,
        ...response.data,
        inputMint,
        outputMint,
        originalAmount: amount
      };
    } catch (error) {
      logger.error(`Error getting Jupiter quote: ${error.message}`);
      return {
        success: false,
        error: error.message || 'Unknown error fetching Jupiter quote',
        inputMint,
        outputMint,
        originalAmount: amount
      };
    }
  }

  /**
   * Executes a swap using Jupiter
   * @param {string} inputMint - Input token mint (or 'SOL' for native SOL)
   * @param {string} outputMint - Output token mint (or 'SOL' for native SOL)  
   * @param {number} amount - Amount to swap
   * @param {Object} wallet - Wallet for signing transactions
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} The swap result
   */
  async executeSwap(inputMint, outputMint, amount, wallet, options = {}) {
    try {
      if (!wallet) {
        throw new Error('Wallet is required for executing swaps');
      }
      
      logger.info(`Executing swap: ${amount} ${inputMint} -> ${outputMint}`);
      
      // 1. Get quote from Jupiter
      const quoteResult = await this.getQuote(inputMint, outputMint, amount, options);
      
      if (!quoteResult.success || !quoteResult.swapTransaction) {
        throw new Error(`Failed to get quote: ${quoteResult.error || 'Unknown error'}`);
      }
      
      // 2. Deserialize and prepare transaction for signing
      let swapTransaction;
      const rawTransaction = Buffer.from(quoteResult.swapTransaction, 'base64');
      
      if (options.useVersionedTransaction) {
        // For versioned transactions (future support)
        swapTransaction = VersionedTransaction.deserialize(rawTransaction);
      } else {
        // For legacy transactions
        swapTransaction = Transaction.from(rawTransaction);
      }
      
      // 3. Sign and send transaction
      logger.info('Signing and sending swap transaction...');
      
      if (this.connection.rpcEndpoint.includes('devnet')) {
        logger.warn('WARNING: Executing swap on devnet. This is not recommended for real trades.');
      }
      
      // Demo mode check - don't actually execute if in demo mode
      if (wallet.demoMode) {
        logger.info('Demo mode: Not executing actual transaction');
        
        return {
          success: true,
          inAmount: quoteResult.inAmount,
          outAmount: quoteResult.outAmount,
          priceImpactPct: quoteResult.priceImpactPct,
          signature: `demo_tx_${Date.now().toString(16)}`,
          demoMode: true
        };
      }
      
      const {
        skipPreflight = false,
        maxRetries = 2
      } = options;
      
      // Real execution
      const signature = await wallet.sendTransaction(
        swapTransaction, 
        this.connection,
        { skipPreflight, maxRetries }
      );
      
      logger.info(`Swap transaction sent with signature: ${signature}`);
      
      // 4. Confirm transaction
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      logger.info(`Swap successfully confirmed: ${signature}`);
      
      return {
        success: true,
        signature,
        inAmount: quoteResult.inAmount,
        outAmount: quoteResult.outAmount,
        priceImpactPct: quoteResult.priceImpactPct,
        route: quoteResult.routePlan,
        inputMint: quoteResult.inputMint,
        outputMint: quoteResult.outputMint
      };
    } catch (error) {
      logger.error(`Swap execution failed: ${error.message}`);
      
      return {
        success: false,
        error: error.message || 'Unknown error during swap execution',
        inputMint,
        outputMint
      };
    }
  }

  /**
   * Snipe a token (SOL to token swap optimized for sniping)
   * @param {string} tokenMint - Token mint address to snipe
   * @param {number} amountInSol - Amount of SOL to spend
   * @param {Object} wallet - Wallet for signing
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} The snipe result
   */
  async snipeToken(tokenMint, amountInSol, wallet, options = {}) {
    try {
      logger.info(`Sniping token ${tokenMint} with ${amountInSol} SOL`);
      
      // Special sniping options with more aggressive defaults
      const snipeOptions = {
        slippage: options.slippage || 5, // Higher default slippage for sniping
        skipPreflight: options.skipPreflight !== false, // Default to true for sniping
        maxRetries: options.maxRetries || 3,
        onlyDirectRoutes: options.onlyDirectRoutes || false, // Could be true for faster execution
        useVersionedTransaction: false, // Stick with legacy transactions for compatibility
        ...options
      };
      
      // Execute swap from SOL to token
      return await this.executeSwap('SOL', tokenMint, amountInSol, wallet, snipeOptions);
    } catch (error) {
      logger.error(`Snipe operation failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        tokenMint
      };
    }
  }

  /**
   * Get token price relative to SOL
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<number>} Price in SOL per token
   */
  async getTokenPrice(tokenMint) {
    try {
      // Use a small amount for price quote to minimize price impact
      const smallAmount = 0.01; // 0.01 SOL
      
      const quoteResult = await this.getQuote('SOL', tokenMint, smallAmount);
      
      if (!quoteResult.success) {
        throw new Error(`Failed to get price: ${quoteResult.error}`);
      }
      
      // Calculate price: outAmount tokens per smallAmount SOL
      // Price = SOL per token = smallAmount / outTokens
      const outTokens = parseFloat(quoteResult.outAmount);
      const price = smallAmount / outTokens;
      
      logger.debug(`Price for ${tokenMint}: ${price} SOL per token`);
      
      return price;
    } catch (error) {
      logger.error(`Error getting token price: ${error.message}`);
      // Return a negative value to indicate error
      return -1;
    }
  }
}

module.exports = JupiterClient; 