const { Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');

class WalletManager {
  constructor(connection) {
    this.connection = connection;
    this.wallet = null;
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
    if (!this.wallet) throw new Error('Wallet not loaded');
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  async getTokenBalances() {
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
    return this.wallet ? this.wallet.publicKey.toString() : null;
  }

  getKeypair() {
    return this.wallet;
  }
}

module.exports = WalletManager; 