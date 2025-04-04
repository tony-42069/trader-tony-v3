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
      // Log more detailed error information
      let errorDetails = error.message;
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        errorDetails += ` | Status: ${error.response.status} | Data: ${JSON.stringify(error.response.data)}`;
      } else if (error.request) {
        // The request was made but no response was received
        errorDetails += ' | No response received from Jupiter API';
      } else {
        // Something happened in setting up the request that triggered an Error
        errorDetails += ' | Error setting up request';
      }
      // Simplified logging attempt
      logger.error(`!!! DETAILED getQuote ERROR: ${error.message} !!!`); 
      // logger.error(`Error getting Jupiter quote: ${errorDetails}`, error); // Original detailed log commented out

      return {
        success: false,
        // Return a more informative error message if possible
        error: error.response?.data?.message || error.response?.data?.error || error.message || 'Unknown error fetching Jupiter quote',
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

      // Resolve 'SOL' string to WSOL address for comparison
      const resolvedInputMint = (inputMint === 'SOL') ? this.SOL_MINT : inputMint;
      const resolvedOutputMint = (outputMint === 'SOL') ? this.SOL_MINT : outputMint;

      // Check if input and output mints are the same AFTER resolving 'SOL'
      if (resolvedInputMint === resolvedOutputMint) {
          logger.error(`executeSwap cannot proceed: Input mint and output mint are the same (${resolvedInputMint}).`);
          return {
              success: false,
              error: `Input and output tokens cannot be the same: ${resolvedInputMint}`,
              inputMint: resolvedInputMint, // Use resolved values in error
              outputMint: resolvedOutputMint
          };
      }
      
      // 1. Get quote from Jupiter (using original input/output which might contain 'SOL')
      const quoteResult = await this.getQuote(inputMint, outputMint, amount, options);
      
      // If getting the quote failed, log it and return the failure result directly
      // This allows the detailed error logged within getQuote to be the primary source
      if (!quoteResult.success) {
        logger.error(`executeSwap cannot proceed because getQuote failed: ${quoteResult.error}`);
        // Return the failure object from getQuote, which now contains more details
        return { 
            success: false, 
            error: `Failed to get quote: ${quoteResult.error}`, // Keep context
            inputMint: quoteResult.inputMint, 
            outputMint: quoteResult.outputMint 
        };
      }

      // Check specifically for swapTransaction after confirming success
      if (!quoteResult.swapTransaction) {
           logger.error(`executeSwap cannot proceed: Quote successful but swapTransaction missing.`);
           return { 
               success: false, 
               error: 'Quote successful but swapTransaction missing from Jupiter response.',
               inputMint: quoteResult.inputMint, 
               outputMint: quoteResult.outputMint 
           };
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
   * @returns {Promise<number>} Price in SOL per token, or -1 on error
   */
  async getTokenPrice(tokenMint) {
    // console.log(`--- ENTERING getTokenPrice with tokenMint: "${tokenMint}" ---`); // Remove previous console log
    
    // Robust Primary WSOL Check
    const wsolAddress = "so11111111111111111111111111111111111111112";
    // Ensure tokenMint is treated as a string for reliable comparison
    const tokenMintStr = typeof tokenMint === 'string' ? tokenMint : tokenMint?.toString();

    if (tokenMintStr && tokenMintStr.toLowerCase() === wsolAddress) {
        logger.info(`[getTokenPrice] Direct WSOL detection PASSED - returning fixed price 1.0 for input: ${tokenMintStr}`);
        return 1.0;
    } else {
         logger.info(`[getTokenPrice] Direct WSOL detection FAILED for input: "${tokenMintStr}". Proceeding to fetch price via API.`);
    }
      
    try {
      // --- Try Token -> SOL quote FIRST for potentially better accuracy ---
      logger.debug(`Attempting reverse quote first: ${tokenMint} -> SOL`);
      let inputDecimalsForReverse = 9; // Default, fetch if possible
      try {
          const tokenInfo = await this.connection.getParsedAccountInfo(new PublicKey(tokenMint));
          if (tokenInfo?.value?.data?.parsed?.info?.decimals !== undefined) {
              inputDecimalsForReverse = tokenInfo.value.data.parsed.info.decimals;
          } else {
               logger.warn(`Could not fetch decimals for ${tokenMint}, assuming 9.`);
          }
      } catch (decError) {
          logger.warn(`Error fetching decimals for ${tokenMint}: ${decError.message}, assuming 9.`);
      }

      // Quote for 1 unit of the token
      const reverseQuoteResult = await this.getQuote(tokenMint, 'SOL', 1, { inputDecimals: inputDecimalsForReverse }); 
      
      if (reverseQuoteResult.success) {
        // Price = SOL per token = outAmount SOL / 1 token
        // outAmount is in lamports, convert to SOL
        const price = parseFloat(reverseQuoteResult.outAmount) / LAMPORTS_PER_SOL; 
        logger.debug(`Price for ${tokenMint} (from reverse quote): ${price} SOL per token`);
        // Ensure price is not negative or NaN before returning
        if (!isNaN(price) && price >= 0) {
            return price;
        } else {
            logger.warn(`Reverse quote resulted in invalid price (${price}), attempting forward quote.`);
        }
      } else {
         logger.debug(`Reverse quote ${tokenMint} -> SOL failed: ${reverseQuoteResult.error}. Attempting forward quote.`);
      }
      // --- End Reverse Quote Attempt ---

      // --- Fallback to SOL -> Token quote ---
      logger.debug(`Attempting forward quote: SOL -> ${tokenMint}`);
      const smallAmount = 0.01; // 0.01 SOL
      const quoteResult = await this.getQuote('SOL', tokenMint, smallAmount);

      if (!quoteResult.success) {
         // If both directions fail
         throw new Error(`Failed to get price from both directions. Reverse Error: ${reverseQuoteResult.error || 'N/A'}. Forward Error: ${quoteResult.error}`);
      }

      // Calculate price from SOL -> Token quote (This is now the fallback)
      // Price = SOL per token = smallAmount SOL / outTokens (in standard unit)
      
      // --- Robust Decimal Fetching (for forward quote) ---
      let outputDecimals = null;
      try {
          // Prioritize fetching decimals directly from the mint account info
          const tokenInfo = await this.connection.getParsedAccountInfo(new PublicKey(tokenMint));
          if (tokenInfo?.value?.data?.parsed?.info?.decimals !== undefined) {
              outputDecimals = tokenInfo.value.data.parsed.info.decimals;
              logger.debug(`Using decimals ${outputDecimals} from chain for ${tokenMint}`);
          } else {
              // Fallback: Try to infer from quote response (less reliable)
              const routePlan = quoteResult.routePlan || [];
              const lastMarketInfo = routePlan[routePlan.length - 1]?.marketInfos?.[routePlan[routePlan.length - 1].marketInfos.length - 1];
               if (lastMarketInfo?.outputMint === tokenMint && lastMarketInfo?.lpMint?.decimals !== undefined) {
                   outputDecimals = lastMarketInfo.lpMint.decimals;
                   logger.debug(`Using decimals ${outputDecimals} from quote response for ${tokenMint}`);
               } else {
                    logger.warn(`Could not determine decimals for ${tokenMint}, assuming 9.`);
                    outputDecimals = 9; // Assume 9 if all else fails
               }
          }
      } catch (decError) {
          logger.warn(`Error fetching decimals for ${tokenMint}: ${decError.message}, assuming 9.`);
          outputDecimals = 9; // Assume 9 on error
      }
      // --- End Decimal Fetching ---

      const outTokensInSmallestUnit = parseFloat(quoteResult.outAmount);
      // Ensure we don't divide by zero if decimals somehow end up null/undefined
      const divisor = (outputDecimals !== null && outputDecimals >= 0) ? (10 ** outputDecimals) : 1;
      const outTokens = outTokensInSmallestUnit / divisor; // Convert to standard unit

      if (outTokens === 0) {
         logger.error(`Forward quote resulted in zero output tokens for ${tokenMint}. Cannot calculate price.`);
         // Do NOT attempt reverse quote here, as it was already tried or failed.
         return -1; // Indicate error
      }

      const price = smallAmount / outTokens;

      logger.debug(`Price for ${tokenMint} (from forward quote): ${price} SOL per token`);

      // Ensure price is not negative or NaN before returning
      if (!isNaN(price) && price >= 0) {
          return price;
      } else {
          logger.error(`Forward quote resulted in invalid price (${price}) for ${tokenMint}.`);
          return -1; // Indicate error
      }

    } catch (error) {
      // Log the specific error encountered during the process
      logger.error(`Error getting token price for ${tokenMint}: ${error.message}`);
      
      // Add WSOL fallback check within the catch block
      const wsolAddressFallback = "so11111111111111111111111111111111111111112";
      const tokenMintStrFallback = typeof tokenMint === 'string' ? tokenMint : tokenMint?.toString();
      if (tokenMintStrFallback && tokenMintStrFallback.toLowerCase() === wsolAddressFallback) {
          logger.warn(`[getTokenPrice] Fallback: Detected WSOL after API failure for "${tokenMintStrFallback}", returning fixed price 1.0`);
          return 1.0;
      }

      // Return a negative value to indicate error if not WSOL
      return -1;
    }
  }
}

module.exports = JupiterClient;
