// Transaction utility for TraderTony v3 bot
const { 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram
} = require('@solana/web3.js');
const { 
  Token, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} = require('@solana/spl-token');
const logger = require('./logger');

/**
 * Transaction utility class
 */
class TransactionUtility {
  constructor(solanaClient) {
    this.solanaClient = solanaClient;
  }

  /**
   * Buy a token with SOL
   * @param {string} tokenAddress - The token mint address
   * @param {number} amountSol - The amount of SOL to spend
   * @param {number} slippage - Slippage tolerance percentage
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Transaction result
   */
  async buyToken(tokenAddress, amountSol, slippage = 1, options = {}) {
    try {
      // If in demo mode, use the simulate function
      if (this.solanaClient.demoMode) {
        return await this.solanaClient.simulateBuy(tokenAddress, amountSol, slippage);
      }

      logger.info(`Buying token ${tokenAddress} with ${amountSol} SOL (slippage: ${slippage}%)`);
      
      // Use the Jupiter client for DEX swap
      const jupiterClient = this.solanaClient.jupiterClient;
      if (!jupiterClient) {
        throw new Error('Jupiter client not initialized');
      }
      
      const walletManager = this.solanaClient.walletManager;
      if (!walletManager || !walletManager.getKeypair()) {
        throw new Error('Wallet not initialized');
      }
      
      // Combine provided options with defaults
      const buyOptions = {
        slippage,
        // Default options for buying
        skipPreflight: options.skipPreflight ?? false,
        maxRetries: options.maxRetries ?? 2,
        priorityFee: options.priorityFee ?? 30000, // 30,000 microLamports (medium priority)
        onlyDirectRoutes: options.onlyDirectRoutes ?? false,
        // Add any other options provided
        ...options
      };
      
      // Execute the swap using Jupiter
      const swapResult = await jupiterClient.executeSwap(
        'SOL', 
        tokenAddress, 
        amountSol, 
        walletManager, 
        buyOptions
      );
      
      if (!swapResult.success) {
        throw new Error(`Swap failed: ${swapResult.error}`);
      }
      
      // Format the result to match expected output format
      return {
        success: true,
        transactionHash: swapResult.signature,
        amount: amountSol,
        tokenAmount: parseFloat(swapResult.outAmount),
        price: amountSol / parseFloat(swapResult.outAmount),
        timestamp: Date.now(),
        priceImpact: swapResult.priceImpactPct,
        additionalInfo: {
          slippage,
          route: swapResult.route
        }
      };
    } catch (error) {
      logger.error(`Error buying token: ${error.message}`);
      return {
        success: false,
        error: error.message,
        tokenAddress,
        amountSol
      };
    }
  }
  
  /**
   * Sell a token for SOL
   * @param {string} tokenAddress - The token mint address
   * @param {number} tokenAmount - The amount of token to sell
   * @param {number} slippage - Slippage tolerance percentage
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Transaction result
   */
  async sellToken(tokenAddress, tokenAmount, slippage = 1, options = {}) {
    try {
      // If in demo mode, simulate a sell
      if (this.solanaClient.demoMode) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Generate a fake transaction hash
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let txHash = '';
        for (let i = 0; i < 64; i++) {
          txHash += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        return {
          success: true,
          transactionHash: txHash,
          tokenAmount: tokenAmount,
          solAmount: tokenAmount * 0.001, // Dummy conversion
          price: 0.001,
          timestamp: Date.now()
        };
      }
      
      logger.info(`Selling ${tokenAmount} of token ${tokenAddress} (slippage: ${slippage}%)`);
      
      // Use the Jupiter client for DEX swap
      const jupiterClient = this.solanaClient.jupiterClient;
      if (!jupiterClient) {
        throw new Error('Jupiter client not initialized');
      }
      
      const walletManager = this.solanaClient.walletManager;
      if (!walletManager || !walletManager.getKeypair()) {
        throw new Error('Wallet not initialized');
      }
      
      // Combine provided options with defaults for selling
      const sellOptions = {
        slippage,
        // Default options for selling
        skipPreflight: options.skipPreflight ?? false,
        maxRetries: options.maxRetries ?? 3, // Extra retry for sells
        priorityFee: options.priorityFee ?? 40000, // 40,000 microLamports (higher priority for sells)
        onlyDirectRoutes: options.onlyDirectRoutes ?? false,
        // Add any other options provided
        ...options
      };
      
      // Execute the swap using Jupiter
      const swapResult = await jupiterClient.executeSwap(
        tokenAddress, 
        'SOL', 
        tokenAmount, 
        walletManager, 
        sellOptions
      );
      
      if (!swapResult.success) {
        throw new Error(`Sell failed: ${swapResult.error}`);
      }
      
      // Format the result to match expected output format
      return {
        success: true,
        transactionHash: swapResult.signature,
        tokenAmount: tokenAmount,
        solAmount: parseFloat(swapResult.outAmount) / LAMPORTS_PER_SOL,
        price: parseFloat(swapResult.outAmount) / LAMPORTS_PER_SOL / tokenAmount,
        timestamp: Date.now(),
        priceImpact: swapResult.priceImpactPct,
        additionalInfo: {
          slippage,
          route: swapResult.route
        }
      };
    } catch (error) {
      logger.error(`Error selling token: ${error.message}`);
      return {
        success: false,
        error: error.message,
        tokenAddress,
        tokenAmount
      };
    }
  }
  
  /**
   * Create a SOL transfer transaction
   * @param {string} toAddress - Recipient address
   * @param {number} amountSol - Amount to send in SOL
   * @param {Object} options - Additional options
   * @returns {Promise<Transaction>} The transaction object
   */
  async createSOLTransferTransaction(toAddress, amountSol, options = {}) {
    try {
      const walletManager = this.solanaClient.walletManager;
      if (!walletManager || !walletManager.getKeypair()) {
        throw new Error('Wallet not initialized');
      }
      
      const keypair = walletManager.getKeypair();
      const connection = this.solanaClient.connection;
      
      // Create a transfer transaction
      const transaction = new Transaction();
      
      // Add compute budget instruction for priority fees (if enabled)
      if (options.priorityFee) {
        transaction.add(
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: options.priorityFee
          })
        );
      }
      
      // Add transfer instruction
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(toAddress),
          lamports: Math.round(amountSol * LAMPORTS_PER_SOL)
        })
      );
      
      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;
      
      return transaction;
    } catch (error) {
      logger.error(`Error creating SOL transfer transaction: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Send a transaction to the network
   * @param {Transaction} transaction - The transaction to send
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Transaction result
   */
  async sendTransaction(transaction, options = {}) {
    try {
      const walletManager = this.solanaClient.walletManager;
      if (!walletManager || !walletManager.getKeypair()) {
        throw new Error('Wallet not initialized');
      }
      
      const connection = this.solanaClient.connection;
      
      // Set options with defaults
      const txOptions = {
        skipPreflight: options.skipPreflight ?? false,
        maxRetries: options.maxRetries ?? 2,
        commitment: options.commitment ?? 'confirmed',
        ...options
      };
      
      // Send transaction using wallet manager
      logger.info('Sending transaction to network...');
      const signature = await walletManager.sendTransaction(transaction, connection, txOptions);
      
      // Confirm transaction
      logger.info(`Transaction sent with signature: ${signature}`);
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: transaction.recentBlockhash,
        lastValidBlockHeight: options.lastValidBlockHeight
      }, txOptions.commitment);
      
      if (confirmation.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      logger.info(`Transaction confirmed: ${signature}`);
      
      return {
        success: true,
        signature,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Error sending transaction: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Set up a stop-loss/take-profit order
   * @param {string} tokenAddress - The token mint address
   * @param {number} stopLossPercentage - Stop loss percentage
   * @param {number} takeProfitPercentage - Take profit percentage
   * @returns {Promise<Object>} Order setup result
   */
  async setupStopLossTakeProfit(tokenAddress, stopLossPercentage, takeProfitPercentage) {
    try {
      // This would set up monitoring for the token price
      // and execute sell transactions when conditions are met
      // For now, just return a placeholder success
      return {
        success: true,
        tokenAddress,
        stopLossPercentage,
        takeProfitPercentage,
        orderId: `order_${Date.now()}`
      };
    } catch (error) {
      logger.error(`Error setting up SL/TP: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = TransactionUtility; 