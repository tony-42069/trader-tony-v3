/**
 * Phantom Wallet Integration Utilities
 * Provides functionality for Phantom Connect integration and Solana Pay
 */
const { PublicKey, Transaction } = require('@solana/web3.js');
const { encodeURL, createQR, findTransactionSignature, validateTransfer, parseURL } = require('@solana/pay');
const QRCode = require('qrcode');
const logger = require('./logger');

/**
 * PhantomConnectManager - Handles Phantom wallet connections and transfers
 */
class PhantomConnectManager {
  constructor(solanaClient) {
    this.solanaClient = solanaClient;
    this.connection = solanaClient.connection;
  }

  /**
   * Generate a Solana Pay transfer request URL for deposits
   * @param {string} receiverAddress - Wallet address to receive funds
   * @param {number} amount - Optional: Amount in SOL to request
   * @param {string} reference - Optional: Reference string for the transaction
   * @param {string} label - Optional: Label for the transaction
   * @param {string} message - Optional: Message for the transaction
   * @returns {Object} The URL and transaction details
   */
  generateTransferRequestURL(receiverAddress, amount = null, reference = null, label = null, message = null) {
    try {
      // Create a new reference if none provided
      let referencePublicKeys = [];
      if (!reference) {
        // Generate a random reference
        const randomBytes = new Uint8Array(16);
        crypto.getRandomValues(randomBytes);
        reference = Buffer.from(randomBytes).toString('hex');
        referencePublicKeys.push(new PublicKey(randomBytes));
      } else if (typeof reference === 'string') {
        try {
          // If it's a string that can be converted to a PublicKey, do so
          referencePublicKeys.push(new PublicKey(reference));
        } catch (e) {
          // Otherwise use it as is
          const randomBytes = new Uint8Array(16);
          crypto.getRandomValues(randomBytes);
          referencePublicKeys.push(new PublicKey(randomBytes));
        }
      }

      // Build the transfer params
      const params = {
        recipient: new PublicKey(receiverAddress),
      };

      // Add optional parameters if provided
      if (amount) {
        params.amount = amount;
      }
      if (referencePublicKeys.length > 0) {
        params.references = referencePublicKeys;
      }
      if (label) {
        params.label = label;
      }
      if (message) {
        params.message = message;
      }

      // Create the Solana Pay URL
      const url = encodeURL(params);

      logger.info(`Generated Solana Pay URL for ${receiverAddress}`);

      return {
        url: url.toString(),
        reference,
        receiverAddress
      };
    } catch (error) {
      logger.error(`Error generating transfer request URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a QR code for a Solana Pay URL
   * @param {string} url - Solana Pay URL
   * @returns {Promise<string>} Base64 encoded QR code image
   */
  async generateQRCode(url) {
    try {
      // Generate QR code as a data URL
      const qrCode = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'H',
        margin: 4,
        scale: 10,
        color: {
          dark: '#000000FF',
          light: '#FFFFFFFF'
        }
      });

      logger.info('Generated QR code for Solana Pay URL');
      return qrCode;
    } catch (error) {
      logger.error(`Error generating QR code: ${error.message}`);
      throw error;
    }
  }

  /**
   * Monitor for transaction completion
   * @param {string} reference - Transaction reference to monitor
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Transaction signature and details
   */
  async monitorTransaction(reference, timeout = 60000) {
    try {
      // Convert reference to PublicKey
      const referencePublicKey = new PublicKey(reference);

      // Poll for the transaction signature
      const startTime = Date.now();
      let signature = null;

      while (!signature) {
        signature = await findTransactionSignature(
          this.connection,
          referencePublicKey,
          undefined,
          'confirmed'
        );

        // Check if we've reached the timeout
        if (!signature && Date.now() - startTime > timeout) {
          throw new Error('Transaction monitoring timed out');
        }

        // If no signature found yet, wait a bit before the next poll
        if (!signature) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Get transaction details
      const transaction = await this.connection.getTransaction(signature.signature);

      logger.info(`Transaction confirmed: ${signature.signature}`);
      return {
        signature: signature.signature,
        transaction
      };
    } catch (error) {
      logger.error(`Error monitoring transaction: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a withdrawal transaction
   * @param {string} recipientAddress - Recipient Phantom wallet address
   * @param {number} amount - Amount in SOL to withdraw
   * @returns {Promise<Object>} Transaction details
   */
  async generateWithdrawalTransaction(recipientAddress, amount) {
    try {
      // Validate inputs
      if (!recipientAddress) throw new Error('Recipient address is required');
      if (!amount || amount <= 0) throw new Error('Valid amount is required');

      // Get wallet from Solana client
      const wallet = this.solanaClient.walletManager;
      if (!wallet || !wallet.keypair) {
        throw new Error('No wallet keypair available for signing');
      }

      // Create transaction
      const transaction = await this.solanaClient.transactionUtility.createSOLTransferTransaction(
        wallet.getPublicKey().toString(),
        recipientAddress,
        amount
      );

      logger.info(`Generated withdrawal transaction to ${recipientAddress} for ${amount} SOL`);
      return transaction;
    } catch (error) {
      logger.error(`Error generating withdrawal transaction: ${error.message}`);
      throw error;
    }
  }
}

module.exports = PhantomConnectManager; 