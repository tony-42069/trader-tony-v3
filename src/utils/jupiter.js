const axios = require('axios');
const { PublicKey, Transaction, Connection } = require('@solana/web3.js');
const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
const logger = require('./logger');

/**
 * Jupiter DEX API client for trading on Solana
 * Uses Jupiter's V6 API: https://station.jup.ag/docs/apis/swap-api
 */
class JupiterClient {
  constructor(connection) {
    this.connection = connection;
    this.apiBaseUrl = 'https://quote-api.jup.ag/v6';
    this.defaultSlippage = 1.0; // 1% default slippage
    this.wsolMint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL mint
  }

  /**
   * Get a quote for a token swap
   * @param {string} inputMint - Input token mint address (or "SOL" for native SOL)
   * @param {string} outputMint - Output token mint address
   * @param {number} amount - Amount in input token's native units (e.g., lamports for SOL)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Quote result
   */
  async getQuote(inputMint, outputMint, amount, options = {}) {
    try {
      logger.info(`Getting Jupiter quote: ${inputMint} → ${outputMint}, amount: ${amount}`);
      
      // Handle native SOL input
      const actualInputMint = inputMint === 'SOL' ? this.wsolMint : inputMint;
      
      // Build quote request URL
      const params = new URLSearchParams({
        inputMint: actualInputMint,
        outputMint,
        amount: Math.floor(amount), // Jupiter expects an integer
        slippageBps: Math.floor((options.slippage || this.defaultSlippage) * 100), // Convert percentage to basis points
        onlyDirectRoutes: options.onlyDirectRoutes || false,
        asLegacyTransaction: options.asLegacyTransaction || false,
        platformFeeBps: options.platformFeeBps || 0
      });
      
      // Make the API request
      const response = await axios.get(`${this.apiBaseUrl}/quote?${params.toString()}`);
      
      // Check for response errors
      if (!response.data || !response.data.quoteResponse) {
        throw new Error('Invalid quote response from Jupiter');
      }
      
      const quoteData = response.data;
      
      logger.debug(`Jupiter quote successful: ${JSON.stringify({
        inputMint: actualInputMint,
        outputMint,
        inAmount: quoteData.quoteResponse.inAmount,
        outAmount: quoteData.quoteResponse.outAmount,
        priceImpactPct: quoteData.quoteResponse.priceImpactPct
      })}`);
      
      return {
        success: true,
        inputMint: actualInputMint,
        outputMint,
        inAmount: quoteData.quoteResponse.inAmount,
        outAmount: quoteData.quoteResponse.outAmount,
        otherAmountThreshold: quoteData.quoteResponse.otherAmountThreshold,
        swapMode: quoteData.quoteResponse.swapMode,
        slippageBps: quoteData.quoteResponse.slippageBps,
        priceImpactPct: quoteData.quoteResponse.priceImpactPct,
        rawData: quoteData
      };
    } catch (error) {
      logger.error(`Jupiter quote error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get swap instructions for a token swap
   * @param {Object} quoteResponse - Quote response from getQuote
   * @param {string} userPublicKey - User's wallet public key
   * @returns {Promise<Object>} Swap instructions
   */
  async getSwapInstructions(quoteResponse, userPublicKey) {
    try {
      if (!quoteResponse.success || !quoteResponse.rawData) {
        throw new Error('Invalid quote response');
      }
      
      const swapRequest = {
        quoteResponse: quoteResponse.rawData.quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true
      };
      
      // Request swap transaction from Jupiter
      const response = await axios.post(
        `${this.apiBaseUrl}/swap`, 
        swapRequest,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.data || !response.data.swapTransaction) {
        throw new Error('Invalid swap response from Jupiter');
      }
      
      logger.debug('Jupiter swap instructions received successfully');
      
      return {
        success: true,
        swapTransaction: response.data.swapTransaction,
        lastValidBlockHeight: response.data.lastValidBlockHeight,
        prioritizationFee: response.data.prioritizationFee
      };
    } catch (error) {
      logger.error(`Jupiter swap instructions error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute a token swap
   * @param {string} inputMint - Input token mint address (or "SOL" for native SOL)
   * @param {string} outputMint - Output token mint address 
   * @param {number} amount - Amount in input token's native units (e.g., lamports for SOL)
   * @param {Object} wallet - Wallet object with signTransaction method
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Swap result
   */
  async executeSwap(inputMint, outputMint, amount, wallet, options = {}) {
    try {
      logger.info(`Executing swap: ${inputMint} → ${outputMint}, amount: ${amount}`);
      
      // 1. Get quote first
      const quote = await this.getQuote(
        inputMint, 
        outputMint, 
        amount, 
        options
      );
      
      if (!quote.success) {
        throw new Error(`Failed to get quote: ${quote.error}`);
      }
      
      // 2. Get swap instructions
      const swapInstructions = await this.getSwapInstructions(
        quote,
        wallet.getKeypair().publicKey.toString()
      );
      
      if (!swapInstructions.success) {
        throw new Error(`Failed to get swap instructions: ${swapInstructions.error}`);
      }
      
      // 3. Deserialize and sign the transaction
      const swapTransactionBuf = Buffer.from(swapInstructions.swapTransaction, 'base64');
      const transaction = Transaction.from(swapTransactionBuf);
      
      // Update blockhash if needed
      if (options.useLatestBlockhash) {
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
      }
      
      // Sign transaction
      const signedTransaction = await wallet.getKeypair().signTransaction(transaction);
      
      // 4. Send and confirm transaction
      const signature = await this.connection.sendRawTransaction(
        signedTransaction.serialize(),
        { 
          skipPreflight: options.skipPreflight || false,
          maxRetries: options.maxRetries || 3,
          preflightCommitment: 'confirmed'
        }
      );
      
      // 5. Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(signature);
      
      logger.info(`Swap transaction confirmed: ${signature}`);
      
      // 6. Return swap result
      return {
        success: true,
        signature,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Swap execution error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Snipe a token (buy when it becomes available)
   * @param {string} tokenMint - Token mint address to snipe
   * @param {number} amountSol - Amount of SOL to spend in whole SOL (not lamports)
   * @param {Object} wallet - Wallet object with signTransaction method
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Snipe result
   */
  async snipeToken(tokenMint, amountSol, wallet, options = {}) {
    try {
      logger.info(`Sniping token ${tokenMint} with ${amountSol} SOL`);
      
      // Convert SOL to lamports
      const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      
      // Use a higher slippage for sniping
      const snipeOptions = {
        slippage: options.slippage || 5, // Default 5% slippage for sniping
        skipPreflight: true, // Skip preflight for faster execution
        useLatestBlockhash: true,
        maxRetries: 5,
        ...options
      };
      
      // Execute the swap
      const result = await this.executeSwap(
        'SOL', // Input is native SOL
        tokenMint,
        amountLamports,
        wallet,
        snipeOptions
      );
      
      if (result.success) {
        logger.info(`Successfully sniped token ${tokenMint}. Transaction: ${result.signature}`);
      } else {
        logger.error(`Failed to snipe token ${tokenMint}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Snipe error for token ${tokenMint}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get token price in SOL
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<number>} Token price in SOL
   */
  async getTokenPrice(tokenMint) {
    try {
      const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenMint}&vsToken=SOL`);
      
      if (response.data && response.data.data && response.data.data[tokenMint]) {
        return response.data.data[tokenMint].price;
      }
      
      throw new Error('Price data not available');
    } catch (error) {
      logger.error(`Error fetching token price: ${error.message}`);
      throw error;
    }
  }
}

module.exports = JupiterClient; 