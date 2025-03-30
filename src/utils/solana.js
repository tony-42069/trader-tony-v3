// Solana utilities for TraderTony v3 bot
const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const logger = require('./logger');
const WalletManager = require('./wallet');
const TransactionUtility = require('./transactions');
const TokenSniper = require('../trading/sniper');
const RiskAnalyzer = require('../trading/risk-analyzer');
const PositionManager = require('../trading/position-manager');
const axios = require('axios');
const JupiterClient = require('../trading/jupiter-client');
const PhantomConnectManager = require('./phantom');

class SolanaClient {
  constructor() {
    this.connection = null;
    this.wallet = null;
    this.walletManager = null;
    this.jupiterClient = null;
    this.transactionUtility = null;
    this.riskAnalyzer = null;
    this.tokenSniper = null;
    this.positionManager = null;
    this.eventListeners = [];
    
    this.initialized = false;
    this.demoMode = false;
    this.readOnlyMode = false;
    this.demoWalletAddress = null;
    
    // Early initialization of position manager in case of demo mode
    this.initPositionManager();
  }

  /**
   * Initialize position manager early
   * @private
   */
  initPositionManager() {
    try {
      const PositionManager = require('../trading/position-manager');
      this.positionManager = new PositionManager(this.connection, this.walletManager);
      
      // Set up Jupiter client for the position manager if available
      if (this.jupiterClient) {
        this.positionManager.setJupiterClient(this.jupiterClient);
      }
      
      logger.info('Position manager initialized');
    } catch (error) {
      logger.error(`Failed to initialize position manager: ${error.message}`);
    }
  }

  /**
   * Initialize the Solana client
   */
  async init() {
    if (this.initialized) {
      return;
    }
    
    try {
      // Load environment variables
      this.demoMode = process.env.DEMO_MODE === 'true';
      this.demoWalletAddress = process.env.DEMO_WALLET_ADDRESS;
      
      // Connect to Solana network
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      this.connection = new Connection(rpcUrl, 'confirmed');
      
      // Initialize wallet manager
      this.walletManager = new WalletManager(this.connection);
      
      // Check if demo mode is enabled
      if (process.env.DEMO_MODE === 'true') {
        // Use demo wallet with predefined address
        this.demoMode = true;
        this.walletManager.demoMode = true; // Ensure wallet manager also has demo mode set
        this.demoWalletAddress = process.env.DEMO_WALLET_ADDRESS || '2PS57B26Sh5Xa22dPSEt9bRgP5FhNsoyFvGUV8t5X232';
        logger.info(`Demo mode enabled with wallet address: ${this.demoWalletAddress}`);
      }
      // Set up wallet if private key is available
      else if (process.env.SOLANA_PRIVATE_KEY) {
        try {
          const publicKey = this.walletManager.loadWalletFromPrivateKey(process.env.SOLANA_PRIVATE_KEY);
          logger.info(`Wallet initialized with address: ${publicKey}`);
        } catch (error) {
          logger.error(`Failed to load wallet from private key: ${error.message}`);
          this.demoMode = true;
          this.walletManager.demoMode = true; // Set demo mode on wallet manager
          logger.info('Falling back to demo mode due to wallet initialization failure');
        }
      } else {
        // No private key provided, use specified wallet address if available, otherwise use demo mode
        if (process.env.WALLET_ADDRESS) {
          // Using real wallet address but in read-only mode (can't sign transactions)
          this.demoMode = true; // Still demo mode since we can't make real transactions
          this.walletManager.demoMode = true; // Set demo mode on wallet manager
          this.readOnlyMode = true; // But we're using a real wallet, so some features can work
          this.demoWalletAddress = process.env.WALLET_ADDRESS;
          logger.info(`Using real wallet address in read-only mode: ${this.demoWalletAddress}`);
          
          // Validate the wallet address
          try {
            new PublicKey(this.demoWalletAddress);
          } catch (error) {
            logger.error(`Invalid wallet address: ${error.message}`);
            this.demoWalletAddress = process.env.DEMO_WALLET_ADDRESS || '2PS57B26Sh5Xa22dPSEt9bRgP5FhNsoyFvGUV8t5X232';
            this.readOnlyMode = false; // Back to full demo mode
            logger.info(`Falling back to demo wallet address: ${this.demoWalletAddress}`);
          }
        } else {
          // No wallet address specified, use demo mode
          this.demoMode = true;
          this.walletManager.demoMode = true; // Set demo mode on wallet manager
          this.readOnlyMode = false;
          this.demoWalletAddress = process.env.DEMO_WALLET_ADDRESS || '2PS57B26Sh5Xa22dPSEt9bRgP5FhNsoyFvGUV8t5X232';
          logger.info('No private key or wallet address provided, using demo mode');
        }
      }
      
      // Initialize risk analyzer
      this.riskAnalyzer = new RiskAnalyzer(this.connection);
      
      // Initialize transaction utility
      this.transactionUtility = new TransactionUtility(this);
      
      // Initialize token sniper
      this.tokenSniper = new TokenSniper(
        this.connection,
        this.walletManager,
        this.riskAnalyzer
      );
      
      // Initialize position manager if not already done
      if (!this.positionManager) {
        const PositionManager = require('../trading/position-manager');
        this.positionManager = new PositionManager(this.connection, this.walletManager);
      } else {
        // Reconnect existing position manager with updated connection and wallet
        this.positionManager.connection = this.connection;
        this.positionManager.wallet = this.walletManager;
        
        // Force reload positions to ensure they're available
        this.positionManager.loadPositions();
      }
      
      // Initialize Jupiter client for DEX integration
      await this.initJupiterClient();
      
      // Initialize Phantom Connect manager
      this.phantomConnectManager = new PhantomConnectManager(this);
      
      // Set up position manager event listeners
      this.setupPositionEventListeners();
      
      this.initialized = true;
      logger.info('Solana client initialized successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize Solana client: ${error.message}`);
      throw error;
    }
  }

  /**
   * Setup position manager event listeners
   */
  setupPositionEventListeners() {
    if (!this.positionManager) return;
    
    // When a position is closed
    this.positionManager.on('positionClosed', (position) => {
      logger.info(`Position closed: ${position.id}, profit: ${position.profit.toFixed(2)}%`);
      // Additional handling if needed
    });
    
    // When a sell is executed
    this.positionManager.on('sellExecuted', (data) => {
      logger.info(`Sell executed for position ${data.positionId}, reason: ${data.reason}`);
      // Additional handling if needed
    });
  }

  /**
   * Get all open positions
   * @returns {Array} Open positions
   */
  getOpenPositions() {
    if (!this.initialized) {
      logger.warn('Attempted to get positions before initialization');
      
      // Even if not initialized, return positions in demo mode
      if (this.demoMode && this.positionManager) {
        logger.info('Retrieving positions in demo mode despite not being fully initialized');
        return this.positionManager.getOpenPositions();
      }
      
      return [];
    }
    
    return this.positionManager.getOpenPositions();
  }

  /**
   * Get all positions (open and closed)
   * @returns {Array} All positions
   */
  getAllPositions() {
    if (!this.initialized) {
      logger.warn('Attempted to get positions before initialization');
      return [];
    }
    
    return this.positionManager.getAllPositions();
  }

  /**
   * Set up stop-loss and take-profit for a token
   * @param {string} tokenAddress - Token address
   * @param {string} positionId - Position ID to update
   * @param {number} stopLossPercentage - Stop loss percentage
   * @param {number} takeProfitPercentage - Take profit percentage
   * @returns {Promise<Object>} Order setup result
   */
  async setupStopLossTakeProfit(tokenAddress, positionId, stopLossPercentage, takeProfitPercentage) {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      // If we don't have a position ID but do have a token address,
      // try to find the most recent open position for that token
      if (!positionId && tokenAddress) {
        const openPositions = this.positionManager.getOpenPositions()
          .filter(p => p.tokenAddress === tokenAddress)
          .sort((a, b) => b.createdAt - a.createdAt);
        
        if (openPositions.length > 0) {
          positionId = openPositions[0].id;
        }
      }
      
      if (!positionId) {
        return { 
          success: false, 
          error: 'No position ID provided and no matching open position found' 
        };
      }
      
      // Update the position with new stop-loss and take-profit values
      const position = this.positionManager.updatePosition(positionId, {
        stopLoss: stopLossPercentage,
        takeProfit: takeProfitPercentage
      });
      
      if (!position) {
        return { 
          success: false, 
          error: `Position ${positionId} not found` 
        };
      }
      
      logger.info(`Stop-loss (${stopLossPercentage}%) and take-profit (${takeProfitPercentage}%) set for position ${positionId}`);
      
      return {
        success: true,
        positionId,
        tokenAddress: position.tokenAddress,
        stopLossPercentage,
        takeProfitPercentage
      };
    } catch (error) {
      logger.error(`Error setting up SL/TP: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Setup trailing stop for a position
   * @param {string} positionId - Position ID
   * @param {number} trailingStopPercentage - Trailing stop percentage
   * @returns {Promise<Object>} Setup result
   */
  async setupTrailingStop(positionId, trailingStopPercentage) {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      const position = this.positionManager.updatePosition(positionId, {
        trailingStop: trailingStopPercentage
      });
      
      if (!position) {
        return { 
          success: false, 
          error: `Position ${positionId} not found` 
        };
      }
      
      logger.info(`Trailing stop (${trailingStopPercentage}%) set for position ${positionId}`);
      
      return {
        success: true,
        positionId,
        tokenAddress: position.tokenAddress,
        trailingStopPercentage
      };
    } catch (error) {
      logger.error(`Error setting up trailing stop: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get the balance of the wallet
   * @returns {Promise<number>} Balance in SOL
   */
  async getBalance() {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      // If in demo mode but NOT in read-only mode, return a mock balance
      if (this.demoMode && !this.readOnlyMode) {
        return 4.2; // Mock balance for demo
      }
      
      // In read-only mode with real wallet, fetch actual balance from blockchain
      if (this.readOnlyMode && this.demoWalletAddress) {
        try {
          const pubkey = new PublicKey(this.demoWalletAddress);
          const balance = await this.connection.getBalance(pubkey);
          return balance / LAMPORTS_PER_SOL; // Convert from lamports to SOL
        } catch (err) {
          logger.error(`Error fetching real balance in read-only mode: ${err.message}`);
          return 4.2; // Fallback to mock if there's an error
        }
      }
      
      // Get real balance from wallet manager (for fully authenticated wallet)
      return await this.walletManager.getBalance();
    } catch (error) {
      logger.error(`Error getting balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get token balances for the wallet
   * @returns {Promise<Array>} Array of token balances
   */
  async getTokenBalances() {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      // If in full demo mode (not read-only), return mock token balances
      if (this.demoMode && !this.readOnlyMode) {
        return [
          {
            mint: 'So11111111111111111111111111111111111111112',
            balance: 4.2,
            decimals: 9,
            symbol: 'SOL',
            name: 'Solana'
          },
          {
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            balance: 100,
            decimals: 6,
            symbol: 'USDC',
            name: 'USD Coin'
          }
        ];
      }
      
      // In read-only mode with real wallet, fetch actual token balances
      if (this.readOnlyMode && this.demoWalletAddress) {
        try {
          const pubkey = new PublicKey(this.demoWalletAddress);
          
          // Get SOL balance
          const solBalance = await this.connection.getBalance(pubkey);
          const solBalanceInSol = solBalance / LAMPORTS_PER_SOL;
          
          // Get token accounts
          const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
            pubkey,
            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
          );
          
          // Format token balances
          const tokens = tokenAccounts.value.map(tokenAccount => {
            const accountData = tokenAccount.account.data.parsed.info;
            const tokenBalance = accountData.tokenAmount;
            
            return {
              mint: accountData.mint,
              balance: tokenBalance.uiAmount,
              decimals: tokenBalance.decimals,
              symbol: 'Unknown', // We would need to fetch token metadata for this
              name: 'Unknown Token'
            };
          });
          
          // Add SOL to the list
          tokens.unshift({
            mint: 'So11111111111111111111111111111111111111112',
            balance: solBalanceInSol,
            decimals: 9,
            symbol: 'SOL',
            name: 'Solana'
          });
          
          return tokens;
        } catch (err) {
          logger.error(`Error fetching token balances in read-only mode: ${err.message}`);
          // Fall back to mock data if there's an error
          return [
            {
              mint: 'So11111111111111111111111111111111111111112',
              balance: 4.2,
              decimals: 9,
              symbol: 'SOL',
              name: 'Solana'
            }
          ];
        }
      }
      
      // Get real token balances from wallet manager (for fully authenticated wallet)
      return await this.walletManager.getTokenBalances();
    } catch (error) {
      logger.error(`Error getting token balances: ${error.message}`);
      return [];
    }
  }

  /**
   * Get the wallet address
   * @returns {string} Wallet address
   */
  getWalletAddress() {
    if (this.demoMode) {
      return this.demoWalletAddress;
    }
    
    return this.walletManager.getPublicKey();
  }

  /**
   * Get token information
   * @param {string} tokenMint - Token mint address
   * @returns {Promise<Object>} Token information
   */
  async getTokenInfo(tokenMint) {
    try {
      // First try Jupiter's API which doesn't require an API key
      try {
        const response = await axios.get(`https://token.jup.ag/all`);
        
        if (response.data && Array.isArray(response.data)) {
          const tokenInfo = response.data.find(
            token => token.address === tokenMint
          );
          
          if (tokenInfo) {
            logger.debug(`Found token info from Jupiter for ${tokenMint}`);
            return {
              address: tokenInfo.address,
              symbol: tokenInfo.symbol,
              name: tokenInfo.name,
              decimals: tokenInfo.decimals,
              logoURI: tokenInfo.logoURI,
              tags: tokenInfo.tags
            };
          }
        }
      } catch (error) {
        logger.debug(`Error fetching token info from Jupiter: ${error.message}`);
      }
      
      // Fallback to on-chain data
      // Check if the token exists on-chain and get basic metadata
      try {
        const mintInfo = await this.connection.getParsedAccountInfo(
          new PublicKey(tokenMint)
        );
        
        if (mintInfo && mintInfo.value) {
          const decimals = mintInfo.value.data.parsed.info.decimals;
          
          return {
            address: tokenMint,
            symbol: `UNK-${tokenMint.substring(0, 4)}`,
            name: `Unknown Token (${tokenMint.substring(0, 8)}...)`,
            decimals,
            logoURI: null,
            tags: []
          };
        }
      } catch (error) {
        logger.debug(`Error fetching on-chain token info: ${error.message}`);
      }
      
      // Return default info if all methods fail
      return {
        address: tokenMint,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 9,
        logoURI: null,
        tags: []
      };
    } catch (error) {
      logger.error(`Failed to get token info for ${tokenMint}: ${error.message}`);
      return {
        address: tokenMint,
        symbol: 'ERROR',
        name: 'Error Fetching Token',
        decimals: 9,
        logoURI: null,
        tags: []
      };
    }
  }

  /**
   * Verify a token contract
   * @param {string} tokenAddress - Token address to verify
   * @returns {Promise<Object>} Verification results
   */
  async verifyToken(tokenAddress) {
    try {
      // In a production bot, this would perform real analysis
      // For now, return mock verification data
      
      // Wait a moment to simulate analysis time
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      return {
        verified: true,
        name: 'Demo Token',
        symbol: 'DEMO',
        creators: ['unknown'],
        mintAuthority: 'unknown',
        freezeAuthority: 'unknown',
        supply: '1000000000',
        decimals: 9,
        risks: {
          level: 'low',
          honeypot: false,
          rugPull: false,
          maliciousCode: false
        }
      };
    } catch (error) {
      logger.error(`Error verifying token: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Simulate a token purchase (demo only)
   * @param {string} tokenAddress - Token to buy
   * @param {number} amount - Amount in SOL
   * @param {number} slippage - Slippage percentage
   * @returns {Promise<Object>} Transaction result
   */
  async simulateBuy(tokenAddress, amount, slippage) {
    try {
      // Simulate network latency
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
        amount: amount,
        tokenAmount: amount * 1000, // Dummy conversion
        price: 0.001,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Error simulating buy: ${error.message}`);
      throw error;
    }
  }

  /**
   * Buy a token with SOL
   * @param {string} tokenAddress - Token address to buy
   * @param {number} amountSol - Amount of SOL to spend
   * @param {number} slippage - Slippage percentage
   * @param {Object} options - Additional options (stopLoss, takeProfit)
   * @returns {Promise<Object>} Transaction result
   */
  async buyToken(tokenAddress, amountSol, slippage, options = {}) {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      // Execute the buy transaction
      const result = await this.transactionUtility.buyToken(tokenAddress, amountSol, slippage);
      
      if (!result.success) {
        return result;
      }
      
      // If the buy was successful, create a position
      if (options.trackPosition !== false) {
        const position = this.positionManager.addPosition(
          tokenAddress,
          result.price || 1.0, // If price is not available, use 1.0 as default
          result.tokenAmount,
          {
            stopLoss: options.stopLoss || null,
            takeProfit: options.takeProfit || null,
            trailingStop: options.trailingStop || null
          }
        );
        
        // Add position info to the result
        result.positionId = position.id;
      }
      
      return result;
    } catch (error) {
      logger.error(`Error buying token: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Sell a token for SOL
   * @param {string} tokenAddress - Token address to sell
   * @param {number} tokenAmount - Amount of token to sell
   * @param {number} slippage - Slippage percentage
   * @returns {Promise<Object>} Transaction result
   */
  async sellToken(tokenAddress, tokenAmount, slippage) {
    if (!this.initialized) {
      await this.init();
    }
    
    return await this.transactionUtility.sellToken(tokenAddress, tokenAmount, slippage);
  }
  
  /**
   * Snipe a token
   * @param {string} tokenAddress - Token address to snipe
   * @param {number} amountSol - Amount of SOL to spend
   * @param {Object} options - Snipe options (slippage, maxRisk, stopLoss, takeProfit)
   * @returns {Promise<Object>} Snipe result
   */
  async snipeToken(tokenAddress, amountSol, options = {}) {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      // If in demo mode, simulate a snipe
      if (this.demoMode) {
        logger.info(`Demo mode: Simulating snipe for token ${tokenAddress} with ${amountSol} SOL`);
        
        // Simulate delay
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Simulate token risk analysis
        const riskLevel = Math.floor(Math.random() * 50);
        logger.info(`Demo mode: Risk analysis completed with level ${riskLevel}%`);
        
        // Generate a fake transaction hash
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let txHash = '';
        for (let i = 0; i < 64; i++) {
          txHash += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        return {
          success: true,
          tokenAddress,
          amountInSol: amountSol,
          signature: txHash,
          positionId: txHash,
          tokenAmount: amountSol * 1000, // Simulated token amount
          riskLevel
        };
      }
      
      // Use the token sniper for real sniping
      return await this.tokenSniper.snipeToken(tokenAddress, amountSol, options);
    } catch (error) {
      logger.error(`Error sniping token: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Analyze token risks
   * @param {string} tokenAddress - Token address to analyze
   * @returns {Promise<Object>} Risk analysis result
   */
  async analyzeTokenRisk(tokenAddress) {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      return await this.riskAnalyzer.analyzeToken(tokenAddress);
    } catch (error) {
      logger.error(`Error analyzing token risk: ${error.message}`);
      return {
        success: false,
        error: error.message,
        riskLevel: 100,
        warnings: ['Error analyzing token']
      };
    }
  }

  /**
   * Initialize trading components
   */
  async initJupiterClient() {
    try {
      const JupiterClient = require('../utils/jupiter');
      this.jupiterClient = new JupiterClient(this.connection);
      
      // Connect Jupiter client to position manager if available
      if (this.positionManager) {
        this.positionManager.setJupiterClient(this.jupiterClient);
      }
      
      logger.info('Jupiter client initialized');
    } catch (error) {
      logger.error(`Failed to initialize Jupiter client: ${error.message}`);
    }
  }
}

module.exports = new SolanaClient();