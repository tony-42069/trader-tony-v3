const axios = require('axios');
const { 
  PublicKey, 
  Transaction, 
  VersionedTransaction, 
  TransactionMessage,
  Connection,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram
} = require('@solana/web3.js');
const logger = require('./logger');

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
        maxRetries = 2,
        priorityFee = 50000, // 50,000 micro-lamports per CU
        computeUnits = 200000, // 200,000 is the default compute unit limit
        useVersionedTransaction = false
      } = options;

      if (useVersionedTransaction) {
        // For versioned transactions (future support)
        swapTransaction = VersionedTransaction.deserialize(rawTransaction);
      } else {
        // For legacy transactions
        swapTransaction = Transaction.from(rawTransaction);
        
        // Add compute budget instruction for priority fee (only for legacy transactions)
        // Note: For versioned transactions, Jupiter's quote API should already include this
        swapTransaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: computeUnits
          }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFee
          })
        );
        
        // Get a fresh blockhash
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
        swapTransaction.recentBlockhash = blockhash;
        swapTransaction.feePayer = new PublicKey(wallet.getPublicKey());
      }
      
      // 3. Sign and send transaction
      logger.info(`Signing and sending swap transaction with priority fee: ${priorityFee} microLamports per CU`);
      
      if (this.connection.rpcEndpoint.includes('devnet')) {
        logger.warn('WARNING: Executing swap on devnet. This is not recommended for real trades.');
      }
      
      // Real execution with improved error handling and confirmation
      let signature;
      try {
        // Send transaction
        signature = await wallet.sendTransaction(
          swapTransaction, 
          this.connection,
          { 
            skipPreflight, 
            maxRetries,
            priorityFee,
            computeUnits,
            commitment: 'confirmed' 
          }
        );
        
        logger.info(`Swap transaction sent with signature: ${signature}`);
      } catch (sendError) {
        logger.error(`Error sending transaction: ${sendError.message}`);
        return {
          success: false,
          error: `Transaction sending failed: ${sendError.message}`,
          inputMint,
          outputMint,
          phase: 'send'
        };
      }
      
      // 4. Confirm transaction with improved handling
      try {
        // Wait for confirmation with timeout
        const confirmationPromise = this.connection.confirmTransaction({
          signature,
          blockhash: swapTransaction.recentBlockhash,
          lastValidBlockHeight: lastValidBlockHeight
        }, 'confirmed');
        
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Transaction confirmation timeout')), 60000); // 60 second timeout
        });
        
        // Race the confirmation against the timeout
        const confirmation = await Promise.race([confirmationPromise, timeoutPromise]);
        
        if (confirmation.value?.err) {
          const errorMsg = typeof confirmation.value.err === 'string' 
            ? confirmation.value.err 
            : JSON.stringify(confirmation.value.err);
          
          throw new Error(`Transaction failed: ${errorMsg}`);
        }
        
        logger.info(`Swap successfully confirmed: ${signature}`);
        
        // 5. Return successful result with detailed information
        return {
          success: true,
          signature,
          inAmount: quoteResult.inAmount,
          outAmount: quoteResult.outAmount,
          priceImpactPct: quoteResult.priceImpactPct,
          route: quoteResult.routePlan,
          inputMint: quoteResult.inputMint,
          outputMint: quoteResult.outputMint,
          slippage: options.slippage || 0.5,
          timestamp: Date.now()
        };
      } catch (confirmError) {
        // For confirmation errors, we'll check if transaction was actually successful
        // Sometimes RPC nodes disconnect during confirmation, but tx still goes through
        try {
          logger.warn(`Confirmation error: ${confirmError.message}. Checking transaction status...`);
          const status = await this.connection.getSignatureStatus(signature);
          
          if (status && status.value && !status.value.err) {
            logger.info(`Transaction actually succeeded despite confirmation error: ${signature}`);
            return {
              success: true,
              signature,
              confirmationError: confirmError.message,
              inAmount: quoteResult.inAmount,
              outAmount: quoteResult.outAmount,
              inputMint: quoteResult.inputMint,
              outputMint: quoteResult.outputMint,
              timestamp: Date.now()
            };
          }
          
          // If we get here, transaction really did fail
          const errorDetails = status && status.value && status.value.err 
            ? JSON.stringify(status.value.err) 
            : confirmError.message;
          
          throw new Error(`Transaction confirmation failed: ${errorDetails}`);
        } catch (statusCheckError) {
          logger.error(`Failed to check transaction status: ${statusCheckError.message}`);
          return {
            success: false,
            error: `Transaction confirmation failed: ${confirmError.message}`,
            maybeSucceeded: true, // We're not sure if it failed or not
            signature,
            inputMint,
            outputMint,
            phase: 'confirm'
          };
        }
      }
    } catch (error) {
      logger.error(`Swap execution failed: ${error.message}`);
      
      return {
        success: false,
        error: error.message || 'Unknown error during swap execution',
        inputMint,
        outputMint,
        phase: 'unknown'
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
        skipPreflight: options.hasOwnProperty('skipPreflight') ? options.skipPreflight : true, // Default to true for sniping
        maxRetries: options.maxRetries || 3,
        onlyDirectRoutes: options.hasOwnProperty('onlyDirectRoutes') ? options.onlyDirectRoutes : true, // Default to true for faster execution
        useVersionedTransaction: false, // Stick with legacy transactions for compatibility

        // Snipes need higher priority fees to compete
        priorityFee: options.priorityFee || 100000, // 100,000 microLamports for snipes (higher priority)
        computeUnits: options.computeUnits || 200000,
        
        // Additional info for tracking
        isSnipe: true,
        snipeTimestamp: Date.now(),
        
        ...options
      };
      
      // Log snipe attempt with detailed info
      logger.info(`Snipe configuration: ${JSON.stringify({
        tokenMint,
        amountInSol,
        slippage: snipeOptions.slippage,
        priorityFee: snipeOptions.priorityFee,
        skipPreflight: snipeOptions.skipPreflight,
        onlyDirectRoutes: snipeOptions.onlyDirectRoutes
      })}`);
      
      // Execute swap from SOL to token with optimized settings
      const result = await this.executeSwap('SOL', tokenMint, amountInSol, wallet, snipeOptions);
      
      // Enhance the result with snipe-specific info
      if (result.success) {
        result.isSnipe = true;
        result.snipeTimestamp = snipeOptions.snipeTimestamp;
        
        // Calculate execution time
        result.executionTimeMs = Date.now() - snipeOptions.snipeTimestamp;
        logger.info(`Snipe successful! Execution time: ${result.executionTimeMs}ms`);
        
        // If this was a real transaction, store the snipe in the DB or another persistent store
        // For demo mode, we'd just log it
        if (!wallet.demoMode && result.signature) {
          logger.info(`Real snipe completed with signature: ${result.signature}`);
          // Here you would store the snipe data
        }
      } else {
        // Detailed logging for failed snipes
        logger.error(`Snipe failed: ${result.error}, phase: ${result.phase || 'unknown'}`);
        result.isSnipe = true;
        result.snipeTimestamp = snipeOptions.snipeTimestamp;
        result.executionTimeMs = Date.now() - snipeOptions.snipeTimestamp;
      }
      
      return result;
    } catch (error) {
      logger.error(`Snipe operation failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        tokenMint,
        isSnipe: true,
        snipeTimestamp: Date.now()
      };
    }
  }

  /**
   * Gets the price of a token in SOL
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<number>} Price in SOL per token
   */
  async getTokenPrice(tokenMint) {
    try {
      // Use a small amount for price quote to minimize price impact
      const smallAmount = 0.01; // 0.01 SOL
      
      // First try SOL to token direction (buying the token)
      let quoteResult = await this.getQuote('SOL', tokenMint, smallAmount);
      
      if (quoteResult.success) {
        // Calculate price: outAmount tokens per smallAmount SOL
        // Price = SOL per token = smallAmount / outTokens
        const outTokens = parseFloat(quoteResult.outAmount);
        if (outTokens > 0) {
          const price = smallAmount / outTokens;
          logger.debug(`Price for ${tokenMint}: ${price} SOL per token (buy direction)`);
          return price;
        }
      }
      
      // If first direction fails, try reverse direction (selling the token)
      // We'll try to sell 1 token to get a price estimate
      const tokenAmount = 1;
      quoteResult = await this.getQuote(tokenMint, 'SOL', tokenAmount);
      
      if (quoteResult.success) {
        // This directly gives us price in SOL
        const price = parseFloat(quoteResult.outAmount);
        logger.debug(`Price for ${tokenMint}: ${price} SOL per token (sell direction)`);
        return price;
      }
      
      throw new Error(`Failed to get price from both directions: ${quoteResult.error}`);
    } catch (error) {
      logger.error(`Error getting token price: ${error.message}`);
      // Return a negative value to indicate error
      return -1;
    }
  }
}

module.exports = JupiterClient; 