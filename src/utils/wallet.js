const { Keypair, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');

class WalletManager {
  constructor(connection) {
    this.connection = connection;
    this.wallet = null;
    this.demoMode = false;
    this.demoBalance = 10;
  }

  loadWalletFromPrivateKey(privateKeyBase58) {
    try {
      const privateKey = bs58.decode(privateKeyBase58);
      this.wallet = Keypair.fromSecretKey(privateKey);
      return this.wallet.publicKey.toString();
    } catch (error) {
      throw new Error(`Failed to load wallet: ${error.message}`);
    }
  }

  async getBalance() {
    if (this.demoMode) {
      return this.demoBalance;
    }
    
    if (!this.wallet) throw new Error('Wallet not loaded');
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  async getTokenBalances() {
    if (this.demoMode) {
      return [
        {
          mint: 'So11111111111111111111111111111111111111112',
          balance: this.demoBalance,
          decimals: 9
        },
        {
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          balance: 100,
          decimals: 6
        }
      ];
    }
    
    if (!this.wallet) throw new Error('Wallet not loaded');
    
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      this.wallet.publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );
    
    return tokenAccounts.value.map(account => {
      const accountData = account.account.data.parsed.info;
      return {
        mint: accountData.mint,
        balance: accountData.tokenAmount.uiAmount,
        decimals: accountData.tokenAmount.decimals
      };
    });
  }

  getPublicKey() {
    if (this.demoMode) {
      const demoWalletAddress = process.env.DEMO_WALLET_ADDRESS || '2PS57B26Sh5Xa22dPSEt9bRgP5FhNsoyFvGUV8t5X232';
      return demoWalletAddress;
    }
    return this.wallet ? this.wallet.publicKey.toString() : null;
  }

  getKeypair() {
    return this.wallet;
  }
  
  /**
   * Sends a transaction to the Solana network
   * @param {Transaction} transaction - The transaction to send
   * @param {Connection} connection - The Solana connection
   * @param {Object} options - Additional options
   * @returns {Promise<string>} Transaction signature
   */
  async sendTransaction(transaction, connection = this.connection, options = {}) {
    try {
      if (this.demoMode) {
        // Return a fake signature in demo mode
        return `demo_tx_${Date.now().toString(16)}`;
      }
      
      if (!this.wallet) {
        throw new Error('Wallet not loaded');
      }
      
      // Set default options
      const {
        skipPreflight = false,
        maxRetries = 3,
        commitment = 'confirmed',
        priorityFee = 5000, // 5000 micro-lamports per CU is a reasonable default
        computeUnits = 200000, // 200,000 is the default compute unit limit
      } = options;
      
      // For versioned transactions (VersionedTransaction)
      if (transaction.constructor.name === 'VersionedTransaction') {
        // Versioned transactions are already signed, we just need to send them
        const signature = await connection.sendTransaction(transaction, {
          skipPreflight,
          maxRetries,
          preflightCommitment: commitment,
        });
        
        return signature;
      }
      
      // For regular transactions (Transaction)
      // 1. Get recent blockhash if not already set
      if (!transaction.recentBlockhash) {
        const { blockhash } = await connection.getLatestBlockhash(commitment);
        transaction.recentBlockhash = blockhash;
      }
      
      // 2. Set the fee payer if not already set
      if (!transaction.feePayer) {
        transaction.feePayer = this.wallet.publicKey;
      }
      
      // 3. Add priority fee instructions if they don't exist already
      // Check if transaction already has a ComputeBudgetProgram instruction
      const hasComputeBudget = transaction.instructions.some(
        instr => instr.programId.equals(ComputeBudgetProgram.programId)
      );
      
      if (!hasComputeBudget && priorityFee > 0) {
        // Prepend compute budget instructions
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: computeUnits
          }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFee
          })
        );
      }
      
      // 4. Sign the transaction
      const signedTransaction = await this.wallet.signTransaction(transaction);
      
      // 5. Send the signed transaction
      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight,
          maxRetries,
          preflightCommitment: commitment,
        }
      );
      
      return signature;
    } catch (error) {
      throw new Error(`Failed to send transaction: ${error.message}`);
    }
  }
}

module.exports = WalletManager; 