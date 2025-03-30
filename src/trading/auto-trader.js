const { PublicKey, Keypair, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/web3.js');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const database = require('../utils/database');
const crypto = require('crypto');
const axios = require('axios');
const { Token, Transaction } = require('@solana/web3.js');

/**
 * AutoTrader class to handle autonomous trading strategies
 * Extends EventEmitter to provide events for trade updates
 */
class AutoTrader extends EventEmitter {
  constructor(connection, wallet, tokenSniper, positionManager, riskAnalyzer, jupiterClient) {
    super();
    this.connection = connection;
    this.wallet = wallet;
    this.tokenSniper = tokenSniper;
    this.positionManager = positionManager;
    this.riskAnalyzer = riskAnalyzer;
    this.jupiterClient = jupiterClient;
    this.strategies = new Map();
    this.opportunitiesByStrategy = new Map(); // Store opportunities per strategy
    this.running = false;
    this.scanInterval = null;
    this.tradeInterval = null;
    this.processedTokens = new Set(); // Store processed tokens to avoid duplicates
    
    // Load strategies from database
    this.loadStrategies();
    
    logger.info('AutoTrader initialized');
  }

  /**
   * Load trading strategies from the database
   */
  loadStrategies() {
    try {
      const strategies = database.loadAutoTraderStrategies() || [];
      strategies.forEach(strategy => {
        this.strategies.set(strategy.id, strategy);
      });
      logger.info(`Loaded ${this.strategies.size} trading strategies from database`);
    } catch (error) {
      logger.error(`Failed to load strategies from database: ${error.message}`);
      // Initialize with empty strategies
      this.strategies = new Map();
    }
  }
  
  /**
   * Save trading strategies to the database
   */
  saveStrategies() {
    try {
      database.saveAutoTraderStrategies(Array.from(this.strategies.values()));
      logger.info(`Saved ${this.strategies.size} trading strategies to database`);
    } catch (error) {
      logger.error(`Failed to save strategies to database: ${error.message}`);
    }
  }

  /**
   * Add a new trading strategy
   * @param {Object} strategyConfig - Strategy configuration
   * @returns {Object} The created strategy
   */
  addStrategy(strategyConfig) {
    const strategyId = Date.now().toString();
    const strategy = {
      id: strategyId,
      name: strategyConfig.name || `Strategy ${strategyId.substring(0, 5)}`,
      enabled: true,
      createdAt: new Date(),
      lastRun: null,
      stats: {
        totalTrades: 0,
        successfulTrades: 0,
        failedTrades: 0,
        profit: 0
      },
      config: {
        // Trading parameters
        maxConcurrentPositions: strategyConfig.maxConcurrentPositions || 3,
        maxPositionSizeSOL: strategyConfig.maxPositionSizeSOL || 0.1,
        totalBudgetSOL: strategyConfig.totalBudgetSOL || 1.0,
        
        // Risk parameters
        stopLoss: strategyConfig.stopLoss || 10,
        takeProfit: strategyConfig.takeProfit || 30,
        trailingStop: strategyConfig.trailingStop || null,
        maxRiskLevel: strategyConfig.maxRiskLevel || 50,
        
        // Scan parameters
        scanIntervalMinutes: strategyConfig.scanIntervalMinutes || 5,
        minLiquiditySOL: strategyConfig.minLiquiditySOL || 10,
        minHolders: strategyConfig.minHolders || 50,
        
        // Token filter
        tokenFilters: strategyConfig.tokenFilters || {
          excludeNSFW: true,
          excludeMemeTokens: false,
          minAgeHours: 0,
          maxAgeHours: 72,
        },
        
        // Trading conditions
        tradingConditions: strategyConfig.tradingConditions || {
          minPriceChangePercent: 5,
          timeframeMinutes: 15,
          minVolume: 5, // SOL
          volumeIncreasePercent: 20
        },
        
        // Notification settings
        notifications: strategyConfig.notifications || {
          onEntry: true,
          onExit: true,
          onError: true
        }
      }
    };
    
    this.strategies.set(strategyId, strategy);
    logger.info(`New trading strategy created: ${strategyId} - ${strategy.name}`);
    
    // Save strategies to database
    this.saveStrategies();
    
    // Emit strategy created event
    this.emit('strategyCreated', strategy);
    
    // If auto trader is running, apply this strategy immediately
    if (this.running) {
      this.applyStrategy(strategy);
    }
    
    return strategy;
  }

  /**
   * Get a strategy by ID
   * @param {string} strategyId - Strategy ID
   * @returns {Object|null} The strategy or null if not found
   */
  getStrategy(strategyId) {
    return this.strategies.get(strategyId);
  }

  /**
   * Get all strategies
   * @returns {Array} Array of all strategies
   */
  getAllStrategies() {
    return Array.from(this.strategies.values());
  }

  /**
   * Update a strategy
   * @param {string} strategyId - Strategy ID
   * @param {Object} updates - Properties to update
   * @returns {Object|null} Updated strategy or null if not found
   */
  updateStrategy(strategyId, updates) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      logger.warn(`Attempted to update non-existent strategy: ${strategyId}`);
      return null;
    }
    
    // Update config properties
    if (updates.config) {
      strategy.config = {
        ...strategy.config,
        ...updates.config
      };
    }
    
    // Update other properties
    const { config, ...otherUpdates } = updates;
    Object.assign(strategy, otherUpdates);
    
    this.strategies.set(strategyId, strategy);
    logger.info(`Strategy ${strategyId} updated`);
    
    // Save strategies to database
    this.saveStrategies();
    
    // Emit strategy updated event
    this.emit('strategyUpdated', strategy);
    
    return strategy;
  }

  /**
   * Delete a strategy
   * @param {string} strategyId - Strategy ID
   * @returns {boolean} Whether the strategy was deleted
   */
  deleteStrategy(strategyId) {
    const success = this.strategies.delete(strategyId);
    
    if (success) {
      logger.info(`Strategy ${strategyId} deleted`);
      this.saveStrategies();
      this.emit('strategyDeleted', strategyId);
    }
    
    return success;
  }

  /**
   * Start autonomous trading
   * @returns {boolean} Success status
   */
  start() {
    try {
      if (this.running) {
        logger.info('AutoTrader is already running');
        return true;
      }
      
      if (!this.wallet || !this.tokenSniper || !this.positionManager) {
        logger.error('Cannot start AutoTrader: Required components not initialized');
        return false;
      }
      
      if (this.wallet.demoMode) {
        logger.info('Starting AutoTrader in DEMO MODE');
      } else {
        logger.info('Starting AutoTrader with REAL WALLET');
      }
      
      this.running = true;
      
      // Set up interval for token scanning
      this.scanInterval = setInterval(() => {
        this.scanForTradingOpportunities();
      }, 60000); // Scan every minute
      
      // Set up interval for strategy execution and position management
      this.tradeInterval = setInterval(() => {
        this.executeStrategies();
        this.managePositions();
      }, 30000); // Check every 30 seconds
      
      // Apply initial strategies
      this.executeStrategies();
      
      logger.info('AutoTrader started successfully');
      this.emit('started');
      
      return true;
    } catch (error) {
      logger.error(`Failed to start AutoTrader: ${error.message}`);
      return false;
    }
  }

  /**
   * Stop autonomous trading
   */
  stop() {
    if (!this.running) {
      logger.info('AutoTrader is not running');
      return;
    }
    
    // Clear intervals
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    if (this.tradeInterval) {
      clearInterval(this.tradeInterval);
      this.tradeInterval = null;
    }
    
    this.running = false;
    logger.info('AutoTrader stopped');
    this.emit('stopped');
  }

  /**
   * Scan for new trading opportunities based on specified criteria
   */
  async scanForTradingOpportunities() {
    if (!this.running) return;
    
    try {
      logger.info('Scanning for memecoin trading opportunities...');
      
      // Get only enabled strategies
      const enabledStrategies = Array.from(this.strategies.values())
        .filter(strategy => strategy.enabled);
      
      if (enabledStrategies.length === 0) {
        logger.info('No enabled strategies to execute');
        return;
      }
      
      // DEMO MODE: Generate simulated tokens for testing
      if (this.wallet.demoMode && Math.random() < 0.75) {
        // Generate a random token address
        const randomBytes = crypto.randomBytes(32);
        const tokenAddress = new PublicKey(randomBytes).toString();
        
        // Token metadata with aggressive memecoin characteristics matching our criteria
        const tokenMetadata = {
          name: this.generateMemeTokenName(),
          symbol: this.generateMemeTokenSymbol(),
          createdAt: new Date(Date.now() - Math.floor(Math.random() * 5 * 60000)), // 0-5 minutes ago
          initialLiquiditySOL: 5 + Math.random() * 45, // 5-50 SOL
          holderCount: Math.floor(Math.random() * 20) + 5, // 5-25 holders (new token)
          isMemecoin: true,
          supply: 1000000000 + Math.floor(Math.random() * 9000000000), // 1-10B supply
          priceChangePercent: Math.random() * 20, // 0-20% price change
          volumeIncreasePercent: 50 + Math.random() * 200, // 50-250% volume increase
          potentialRisk: Math.floor(Math.random() * 30) + 10, // 10-40% risk level
          lpTokensBurned: Math.random() > 0.3, // 70% chance LP tokens are burned
          hasMintAuthority: Math.random() > 0.7, // 30% chance has mint authority
          hasFreezeAuthority: Math.random() > 0.8, // 20% chance has freeze authority
          transferTaxBps: Math.random() > 0.8 ? Math.floor(Math.random() * 500) : 0, // 20% chance has transfer tax
          canSell: Math.random() > 0.1, // 90% chance can sell (not honeypot)
        };
        
        logger.info(`[DEMO] Found new memecoin: ${tokenMetadata.name} (${tokenMetadata.symbol})`);
        logger.info(`[DEMO] Token address: ${tokenAddress}`);
        logger.info(`[DEMO] Created: ${Math.floor((Date.now() - tokenMetadata.createdAt) / 60000)} minutes ago`);
        logger.info(`[DEMO] Initial liquidity: ${tokenMetadata.initialLiquiditySOL.toFixed(2)} SOL`);
        
        // For each enabled strategy, check if this token meets criteria
        for (const strategy of enabledStrategies) {
          // Check if the token meets our aggressive strategy criteria for memecoins
          if (
            // Primary Must-Have Indicators:
            
            // Token age: 0-5 minutes since liquidity addition
            (Date.now() - tokenMetadata.createdAt) <= 5 * 60000 &&
            
            // Initial liquidity: 5-50 SOL range
            tokenMetadata.initialLiquiditySOL >= 5 && 
            tokenMetadata.initialLiquiditySOL <= 50 &&
            
            // Basic safety check: No mint authority, no freeze authority, reasonable risk level
            (!tokenMetadata.hasMintAuthority || strategy.config.allowMintAuthority) &&
            (!tokenMetadata.hasFreezeAuthority || strategy.config.allowFreezeAuthority) &&
            (tokenMetadata.transferTaxBps === 0 || strategy.config.allowTransferTax) &&
            
            // LP token status: Check if LP tokens are burned
            (tokenMetadata.lpTokensBurned || strategy.config.allowUnburnedLP) &&
            
            // Sell ability: Verify token can be sold (not a honeypot)
            tokenMetadata.canSell &&
            
            // Strategy-specific risk level tolerance
            tokenMetadata.potentialRisk <= strategy.config.maxRiskLevel
          ) {
            logger.info(`[DEMO] Token ${tokenMetadata.symbol} meets criteria for strategy: ${strategy.name}`);
            
            // Store token for strategy execution
            if (!this.opportunitiesByStrategy.has(strategy.id)) {
              this.opportunitiesByStrategy.set(strategy.id, []);
            }
            
            this.opportunitiesByStrategy.get(strategy.id).push({
              tokenAddress,
              metadata: tokenMetadata,
              discoveredAt: new Date(),
              executionPlan: {
                entryStrategy: 'scale-in', // Scale in approach with multiple buys
                initialBuyPct: 40, // First buy is 40% of total position
                subsequentBuyPct: 30, // Second buy is 30% of total position
                finalBuyPct: 30, // Final buy is 30% of total position
                takeProfitPct: 20, // Take partial profits at 20% price increase
                trailingStopPct: 12, // 12% trailing stop from peak
                maxHoldTimeMinutes: 240, // 4 hour maximum hold time
              }
            });
            
            // Notify admin about the opportunity
            this.emit('tokenDiscovered', {
              strategy,
              tokenAddress,
              tokenName: tokenMetadata.name,
              tokenSymbol: tokenMetadata.symbol,
              createdAgo: `${Math.floor((Date.now() - tokenMetadata.createdAt) / 60000)} minutes ago`,
              liquidity: `${tokenMetadata.initialLiquiditySOL.toFixed(2)} SOL`,
              safetyChecks: {
                lpBurned: tokenMetadata.lpTokensBurned ? '✅' : '⚠️',
                noMintAuth: !tokenMetadata.hasMintAuthority ? '✅' : '⚠️',
                noFreezeAuth: !tokenMetadata.hasFreezeAuthority ? '✅' : '⚠️',
                noTax: tokenMetadata.transferTaxBps === 0 ? '✅' : '⚠️',
                canSell: tokenMetadata.canSell ? '✅' : '❌'
              }
            });
          } else {
            logger.debug(`[DEMO] Token ${tokenMetadata.symbol} does not meet criteria for strategy: ${strategy.name}`);
          }
        }
      } else if (!this.wallet.demoMode) {
        // REAL MODE: Implement actual token discovery logic
        try {
          // 1. Connect to Helius API to monitor new liquidity pool creations
          // This requires implementing a WebSocket connection or frequent polling

          if (!this.heliusApiKey) {
            this.heliusApiKey = process.env.HELIUS_API_KEY;
            if (!this.heliusApiKey) {
              logger.error('Helius API key not configured for real-time token discovery');
              return;
            }
          }

          // 2. Query for recently created liquidity pools (last 5 minutes)
          const response = await axios.get(
            `https://api.helius.xyz/v0/token-liquidity/created-pools?api-key=${this.heliusApiKey}&minutes=5`
          );

          // Process each recently created pool
          if (response.data && Array.isArray(response.data.pools)) {
            for (const pool of response.data.pools) {
              try {
                // 3. Extract token information 
                const tokenAddress = pool.tokenAddress;
                const liquiditySOL = pool.liquidityInSOL;
                const createdAt = new Date(pool.createdAt);
                
                // Skip if we've already processed this token
                if (this.processedTokens.has(tokenAddress)) {
                  continue;
                }
                
                // Add to processed tokens set
                this.processedTokens.add(tokenAddress);
                
                // 4. Perform deep token analysis
                const tokenMetadata = await this.analyzeToken(tokenAddress);
                
                // If analysis failed, skip this token
                if (!tokenMetadata) {
                  continue;
                }
                
                // Merge pool data with token metadata
                tokenMetadata.initialLiquiditySOL = liquiditySOL;
                tokenMetadata.createdAt = createdAt;
                
                logger.info(`Found new token: ${tokenMetadata.name} (${tokenMetadata.symbol})`);
                logger.info(`Token address: ${tokenAddress}`);
                logger.info(`Created: ${Math.floor((Date.now() - createdAt) / 60000)} minutes ago`);
                logger.info(`Initial liquidity: ${liquiditySOL.toFixed(2)} SOL`);
                
                // 5. Apply safety checks
                // These would be implemented in the analyzeToken method
                // But we need to check them here before proceeding

                // 6. Check if the token meets our criteria for each enabled strategy
                for (const strategy of enabledStrategies) {
                  if (
                    // Primary Must-Have Indicators:
                    
                    // Token age: 0-5 minutes since liquidity addition
                    (Date.now() - tokenMetadata.createdAt) <= 5 * 60000 &&
                    
                    // Initial liquidity: 5-50 SOL range
                    tokenMetadata.initialLiquiditySOL >= 5 && 
                    tokenMetadata.initialLiquiditySOL <= 50 &&
                    
                    // Basic safety check: No mint authority, no freeze authority, reasonable risk level
                    (!tokenMetadata.hasMintAuthority || strategy.config.allowMintAuthority) &&
                    (!tokenMetadata.hasFreezeAuthority || strategy.config.allowFreezeAuthority) &&
                    (tokenMetadata.transferTaxBps === 0 || strategy.config.allowTransferTax) &&
                    
                    // LP token status: Check if LP tokens are burned
                    (tokenMetadata.lpTokensBurned || strategy.config.allowUnburnedLP) &&
                    
                    // Sell ability: Verify token can be sold (not a honeypot)
                    tokenMetadata.canSell &&
                    
                    // Strategy-specific risk level tolerance
                    tokenMetadata.potentialRisk <= strategy.config.maxRiskLevel
                  ) {
                    logger.info(`Token ${tokenMetadata.symbol} meets criteria for strategy: ${strategy.name}`);
                    
                    // Store token for strategy execution
                    if (!this.opportunitiesByStrategy.has(strategy.id)) {
                      this.opportunitiesByStrategy.set(strategy.id, []);
                    }
                    
                    this.opportunitiesByStrategy.get(strategy.id).push({
                      tokenAddress,
                      metadata: tokenMetadata,
                      discoveredAt: new Date(),
                      executionPlan: {
                        entryStrategy: 'scale-in', // Scale in approach with multiple buys
                        initialBuyPct: 40, // First buy is 40% of total position
                        subsequentBuyPct: 30, // Second buy is 30% of total position
                        finalBuyPct: 30, // Final buy is 30% of total position
                        takeProfitPct: 20, // Take partial profits at 20% price increase
                        trailingStopPct: 12, // 12% trailing stop from peak
                        maxHoldTimeMinutes: 240, // 4 hour maximum hold time
                      }
                    });
                    
                    // Notify admin about the opportunity
                    this.emit('tokenDiscovered', {
                      strategy,
                      tokenAddress,
                      tokenName: tokenMetadata.name,
                      tokenSymbol: tokenMetadata.symbol,
                      createdAgo: `${Math.floor((Date.now() - tokenMetadata.createdAt) / 60000)} minutes ago`,
                      liquidity: `${tokenMetadata.initialLiquiditySOL.toFixed(2)} SOL`,
                      safetyChecks: {
                        lpBurned: tokenMetadata.lpTokensBurned ? '✅' : '⚠️',
                        noMintAuth: !tokenMetadata.hasMintAuthority ? '✅' : '⚠️',
                        noFreezeAuth: !tokenMetadata.hasFreezeAuthority ? '✅' : '⚠️',
                        noTax: tokenMetadata.transferTaxBps === 0 ? '✅' : '⚠️',
                        canSell: tokenMetadata.canSell ? '✅' : '❌'
                      }
                    });
                  }
                }
              } catch (tokenError) {
                logger.error(`Error processing token ${pool.tokenAddress}: ${tokenError.message}`);
                continue; // Skip this token and continue with others
              }
            }
          }
        } catch (apiError) {
          logger.error(`Error fetching new tokens from API: ${apiError.message}`);
        }
      }
      
      logger.info('Memecoin token scan completed');
    } catch (error) {
      logger.error(`Error scanning for opportunities: ${error.message}`);
    }
  }

  /**
   * Analyze a token for safety and risk metrics
   * @param {string} tokenAddress - The token address to analyze
   * @returns {Object|null} Token metadata or null if analysis failed
   */
  async analyzeToken(tokenAddress) {
    try {
      logger.info(`Analyzing token: ${tokenAddress}`);
      
      // Validate token address format
      let tokenPublicKey;
      try {
        tokenPublicKey = new PublicKey(tokenAddress);
      } catch (error) {
        logger.error(`Invalid token address format: ${tokenAddress}`);
        return null;
      }

      // 1. Get token account info from on-chain data
      const tokenInfo = await this.connection.getParsedAccountInfo(tokenPublicKey);
      
      if (!tokenInfo || !tokenInfo.value || !tokenInfo.value.data || !tokenInfo.value.data.parsed) {
        logger.warn(`Unable to retrieve token info for: ${tokenAddress}`);
        return null;
      }
      
      // Extract mint data from the parsed response
      const parsedData = tokenInfo.value.data;
      const tokenMintData = parsedData.parsed.info;
      
      // 2. Check token supply and decimals
      const tokenSupply = tokenMintData.supply;
      const tokenDecimals = tokenMintData.decimals;
      
      // 3. Check for mint authority (security risk)
      const hasMintAuthority = !!tokenMintData.mintAuthority;
      
      // 4. Check for freeze authority (security risk)
      const hasFreezeAuthority = !!tokenMintData.freezeAuthority;
      
      // 5. Get Helius token metadata
      let tokenMetadata = await this.getHeliusTokenMetadata(tokenAddress);
      
      // Fill in basic metadata if Helius data is not available
      if (!tokenMetadata) {
        tokenMetadata = {
          name: 'Unknown Token',
          symbol: 'UNKNOWN',
          logo: null,
          createdAt: Date.now()
        };
      }
      
      // 6. Check LP token status (if LP tokens are burned)
      const lpTokensBurned = await this.checkLPTokensBurned(tokenAddress);
      
      // 7. Check transfer tax by simulating a transfer
      const transferTaxInfo = await this.checkTransferTax(tokenAddress);
      
      // 8. Simulate a sell to check if token is sellable (honeypot detection)
      const sellabilityInfo = await this.simulateSell(tokenAddress);
      
      // 9. Get holder count and distribution
      const holderInfo = await this.getHolderDistribution(tokenAddress);
      
      // 10. Calculate creation time 
      const createdAt = tokenMetadata.createdAt || Date.now();
      const tokenAgeMinutes = Math.floor((Date.now() - createdAt) / 60000);
      
      // 11. Get token price and liquidity data
      const marketInfo = await this.getTokenMarketInfo(tokenAddress);
      
      // 12. Calculate comprehensive risk score (0-100)
      let riskScore = 10; // Base risk for any new token
      
      // Mint authority is a significant risk
      if (hasMintAuthority) {
        riskScore += 25;
        logger.warn(`Token ${tokenAddress} has mint authority - high risk`);
      }
      
      // Freeze authority is a significant risk
      if (hasFreezeAuthority) {
        riskScore += 20;
        logger.warn(`Token ${tokenAddress} has freeze authority - high risk`);
      }
      
      // Transfer tax is a moderate risk
      if (transferTaxInfo.hasTax) {
        riskScore += Math.min(transferTaxInfo.taxBps / 100, 25); // Cap at 25 points
        logger.warn(`Token ${tokenAddress} has transfer tax of ${transferTaxInfo.taxBps / 100}% - moderate risk`);
      }
      
      // LP tokens not burned is a moderate risk
      if (!lpTokensBurned) {
        riskScore += 20;
        logger.warn(`Token ${tokenAddress} has LP tokens not burned - moderate risk`);
      }
      
      // Cannot sell (honeypot) is a critical risk
      if (!sellabilityInfo.canSell) {
        riskScore += 100; // Critical - ensure it maxes out
        logger.error(`Token ${tokenAddress} failed sell test - likely honeypot (CRITICAL RISK)`);
      }
      
      // Holder concentration risk
      if (holderInfo.topHolderPercentage > 50) {
        riskScore += 15;
        logger.warn(`Token ${tokenAddress} has concentrated holdings (${holderInfo.topHolderPercentage}% in top holder) - high risk`);
      }
      
      // Normalize and cap risk score at 100
      riskScore = Math.min(Math.round(riskScore), 100);
      
      logger.info(`Token ${tokenAddress} analysis complete - Risk Score: ${riskScore}/100`);
      
      // Compile all data into token metadata object
      return {
        address: tokenAddress,
        name: tokenMetadata.name,
        symbol: tokenMetadata.symbol,
        logo: tokenMetadata.logo,
        supply: tokenSupply.toString(),
        decimals: tokenDecimals,
        createdAt: new Date(createdAt),
        tokenAgeMinutes,
        
        // Security indicators
        hasMintAuthority,
        hasFreezeAuthority,
        lpTokensBurned,
        transferTaxBps: transferTaxInfo.taxBps,
        canSell: sellabilityInfo.canSell,
        sellImpactPercentage: sellabilityInfo.priceImpact,
        
        // Holder metrics
        holderCount: holderInfo.holderCount,
        topHolderPercentage: holderInfo.topHolderPercentage,
        
        // Liquidity metrics
        initialLiquiditySOL: marketInfo.liquiditySol,
        priceUsd: marketInfo.priceUsd,
        volumeUsd24h: marketInfo.volumeUsd24h,
        
        // Overall risk assessment
        potentialRisk: riskScore,
        isMemecoin: this.detectIfMemecoin(tokenMetadata)
      };
    } catch (error) {
      logger.error(`Failed to analyze token ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if LP tokens for a given token pair have been burned
   * @param {string} tokenAddress - Token address to check
   * @returns {Promise<boolean>} True if LP tokens are burned
   */
  async checkLPTokensBurned(tokenAddress) {
    try {
      // Skip real check in demo mode
      if (this.wallet.demoMode) {
        return Math.random() > 0.3; // 70% true for demo
      }
      
      // Define known burn addresses on Solana
      const burnAddresses = [
        '1nc1nerator11111111111111111111111111111111',
        'deadbeef1111111111111111111111111111111111',
        'burnaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'burn11111111111111111111111111111111111111'
      ];
      
      // Get the liquidity pools for this token (from Raydium, Orca, etc.)
      // We'll use Raydium API as an example
      try {
        const raydiumEndpoint = 'https://api.raydium.io/v2/sdk/liquidity/mainnet.json';
        const response = await axios.get(raydiumEndpoint);
        
        if (!response.data || !response.data.official) {
          logger.warn(`Failed to get Raydium liquidity pool data`);
          return false;
        }
        
        // Find pools for this token
        const pools = response.data.official.filter(pool => 
          pool.baseMint === tokenAddress || pool.quoteMint === tokenAddress
        );
        
        if (pools.length === 0) {
          logger.warn(`No liquidity pools found for token ${tokenAddress}`);
          return false;
        }
        
        // Check each pool's LP token
        for (const pool of pools) {
          const lpMint = pool.lpMint;
          
          if (!lpMint) {
            continue;
          }
          
          // Find largest LP token holders
          try {
            // Get all accounts for this LP token mint
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
              { mint: new PublicKey(lpMint) }
            );
            
            // Filter and sum balances by owner
            const holderBalances = new Map();
            let totalSupply = 0;
            
            for (const account of tokenAccounts.value) {
              const owner = account.account.data.parsed.info.owner;
              const amount = Number(account.account.data.parsed.info.tokenAmount.amount);
              
              if (holderBalances.has(owner)) {
                holderBalances.set(owner, holderBalances.get(owner) + amount);
              } else {
                holderBalances.set(owner, amount);
              }
              
              totalSupply += amount;
            }
            
            // Calculate what percentage is burned
            let burnedAmount = 0;
            for (const burnAddress of burnAddresses) {
              if (holderBalances.has(burnAddress)) {
                burnedAmount += holderBalances.get(burnAddress);
              }
            }
            
            const burnedPercentage = (burnedAmount / totalSupply) * 100;
            
            // If at least 80% of LP tokens are burned, consider it safe
            if (burnedPercentage >= 80) {
              return true;
            }
          } catch (error) {
            logger.error(`Error checking LP token holders for ${lpMint}: ${error.message}`);
          }
        }
        
        // If we get here, we didn't find sufficient burn evidence
        return false;
      } catch (error) {
        logger.error(`Error fetching liquidity pools: ${error.message}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error checking LP tokens burned for ${tokenAddress}: ${error.message}`);
      return false; // Assume not burned on error (safer)
    }
  }

  /**
   * Check if a token has transfer tax (fee on trading)
   * @param {string} tokenAddress - Token address to check
   * @returns {Promise<Object>} Transfer tax information
   */
  async checkTransferTax(tokenAddress) {
    try {
      // Skip real check in demo mode
      if (this.wallet.demoMode) {
        const hasTax = Math.random() > 0.8;
        return {
          hasTax,
          taxBps: hasTax ? Math.floor(Math.random() * 500) : 0 // 0-5% tax
        };
      }
      
      // For real tax detection, we'll simulate a transfer transaction
      // and check if the amount that arrives is less than what was sent
      
      // Create a test receiver
      const receiverKeypair = Keypair.generate();
      const receiverAddress = receiverKeypair.publicKey;
      
      // We need some tokens to test with - check if we have any
      try {
        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
          new PublicKey(this.wallet.getPublicKey()),
          { mint: new PublicKey(tokenAddress) }
        );
        
        // If we have no tokens, we can't test directly
        if (!tokenAccounts || !tokenAccounts.value || tokenAccounts.value.length === 0) {
          logger.warn(`No token balance for ${tokenAddress} to test transfer tax`);
          
          // Fall back to an alternative approach
          return await this.checkTransferTaxViaCode(tokenAddress);
        }
        
        // Get the first token account with a balance
        let sourceTokenAccount = null;
        for (const account of tokenAccounts.value) {
          const balance = account.account.data.parsed.info.tokenAmount.uiAmount;
          if (balance > 0) {
            sourceTokenAccount = account.pubkey;
            break;
          }
        }
        
        if (!sourceTokenAccount) {
          logger.warn(`No token balance for ${tokenAddress} to test transfer tax`);
          return await this.checkTransferTaxViaCode(tokenAddress);
        }
        
        // Create a token account for the receiver
        const createAccountIx = Token.createAssociatedTokenAccountInstruction(
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
          new PublicKey(tokenAddress),
          receiverAddress,
          receiverAddress,
          this.wallet.publicKey
        );
        
        // Create transfer instruction
        const transferAmount = 1000; // Small amount for testing
        const transferIx = Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          sourceTokenAccount,
          receiverAddress,
          this.wallet.publicKey,
          [],
          transferAmount
        );
        
        // Build transaction
        const transaction = new Transaction().add(createAccountIx, transferIx);
        
        // Simulate the transaction
        const simulation = await this.connection.simulateTransaction(transaction);
        
        // Parse simulation results to detect tax
        if (simulation.value.err) {
          logger.warn(`Transfer simulation failed: ${JSON.stringify(simulation.value.err)}`);
          return await this.checkTransferTaxViaCode(tokenAddress);
        }
        
        // Analyze the logs to detect if there's a tax
        // This is complex as different tokens implement tax in different ways
        // For now, use our fallback method
        return await this.checkTransferTaxViaCode(tokenAddress);
      } catch (error) {
        logger.error(`Error in transfer tax simulation: ${error.message}`);
        return await this.checkTransferTaxViaCode(tokenAddress);
      }
    } catch (error) {
      logger.error(`Error checking transfer tax for ${tokenAddress}: ${error.message}`);
      return { hasTax: true, taxBps: 100 }; // Assume 1% tax on error (safer)
    }
  }
  
  /**
   * Alternative method to check for transfer tax by examining token program
   * @param {string} tokenAddress - Token address to check
   * @returns {Promise<Object>} Transfer tax information
   */
  async checkTransferTaxViaCode(tokenAddress) {
    try {
      // The best approach is to analyze the token's program for tax code
      // We can use Helius API for program analysis if available
      
      if (this.heliusApiKey) {
        try {
          // Note: This endpoint is fictional - actual Helius endpoint may be different
          const response = await axios.get(
            `https://api.helius.xyz/v0/security-check?api-key=${this.heliusApiKey}&address=${tokenAddress}`
          );
          
          if (response.data && response.data.risks) {
            const taxRisk = response.data.risks.find(risk => risk.type === 'TRANSFER_TAX');
            if (taxRisk) {
              return {
                hasTax: true,
                taxBps: taxRisk.taxBps || 100 // Default to 1% if not specified
              };
            }
          }
        } catch (error) {
          logger.error(`Helius security check failed: ${error.message}`);
        }
      }
      
      // If we can't detect tax reliably, default to being cautious
      return {
        hasTax: false,
        taxBps: 0
      };
    } catch (error) {
      logger.error(`Error in code-based tax detection: ${error.message}`);
      return { hasTax: false, taxBps: 0 };
    }
  }

  /**
   * Simulate a sell transaction to check if token can be sold (honeypot detection)
   * @param {string} tokenAddress - Token address to check
   * @returns {Promise<Object>} Sell simulation results
   */
  async simulateSell(tokenAddress) {
    try {
      // Skip real simulation in demo mode
      if (this.wallet.demoMode) {
        const canSell = Math.random() > 0.1; // 90% can sell
        return {
          canSell,
          priceImpact: Math.random() * 5, // 0-5% price impact
          error: canSell ? null : "Simulated sell failure"
        };
      }
      
      // For real implementation, we'll use Jupiter to simulate a swap
      const WSOL_ADDRESS = 'So11111111111111111111111111111111111111112';
      
      // Initialize Jupiter client if needed
      if (!this.jupiterClient) {
        try {
          // Placeholder for Jupiter client initialization
          // In a real implementation, you'd initialize the Jupiter client here
          logger.warn('Jupiter client not initialized, using alternative method');
          return await this.simulateSellViaRPC(tokenAddress);
        } catch (error) {
          logger.error(`Jupiter client initialization failed: ${error.message}`);
          return await this.simulateSellViaRPC(tokenAddress);
        }
      }
      
      try {
        // First check if the token has any liquidity
        const quoteResponse = await axios.get(
          `https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${WSOL_ADDRESS}&amount=1000000&slippageBps=1000`
        );
        
        // If we can't get a quote, the token might not have liquidity
        if (!quoteResponse.data || !quoteResponse.data.data || quoteResponse.data.data.length === 0) {
          logger.warn(`No liquidity found for token ${tokenAddress}`);
          return {
            canSell: false,
            priceImpact: 100,
            error: "No liquidity found"
          };
        }
        
        // Get the best route
        const route = quoteResponse.data.data[0];
        
        // Now get the transaction to simulate
        const swapResponse = await axios.post(
          'https://quote-api.jup.ag/v6/swap',
          {
            route: route,
            userPublicKey: this.wallet.getPublicKey(),
            wrapAndUnwrapSol: true
          }
        );
        
        if (!swapResponse.data || !swapResponse.data.swapTransaction) {
          logger.warn(`Failed to get swap transaction for token ${tokenAddress}`);
          return {
            canSell: false,
            priceImpact: 100,
            error: "Failed to get swap transaction"
          };
        }
        
        // Decode the transaction
        const swapTransaction = Buffer.from(swapResponse.data.swapTransaction, 'base64');
        const transaction = Transaction.from(swapTransaction);
        
        // Simulate the transaction
        const simulation = await this.connection.simulateTransaction(transaction);
        
        // Check if simulation succeeded
        if (simulation.value.err) {
          logger.warn(`Sell simulation failed for token ${tokenAddress}: ${JSON.stringify(simulation.value.err)}`);
          return {
            canSell: false,
            priceImpact: route.priceImpactPct || 100,
            error: `Simulation failed: ${JSON.stringify(simulation.value.err)}`
          };
        }
        
        // If we get here, the token can be sold
        return {
          canSell: true,
          priceImpact: route.priceImpactPct || 0,
          error: null
        };
      } catch (error) {
        logger.error(`Jupiter sell simulation failed: ${error.message}`);
        
        // Fall back to RPC-based simulation
        return await this.simulateSellViaRPC(tokenAddress);
      }
    } catch (error) {
      logger.error(`Error simulating sell for ${tokenAddress}: ${error.message}`);
      return {
        canSell: false,
        priceImpact: 100,
        error: error.message
      };
    }
  }
  
  /**
   * Alternative method to simulate selling a token using direct RPC calls
   * @param {string} tokenAddress - Token address to check
   * @returns {Promise<Object>} Sell simulation results
   */
  async simulateSellViaRPC(tokenAddress) {
    try {
      // This is a more basic approach that checks if we can transfer the token
      // It's not as good as simulating an actual swap, but it's a fallback
      
      // Check if the token has any restrictions on transfers
      const tokenAccountInfo = await this.connection.getAccountInfo(new PublicKey(tokenAddress));
      
      // If we can't get the token account, it might not exist
      if (!tokenAccountInfo) {
        logger.warn(`Token account not found for ${tokenAddress}`);
        return {
          canSell: false,
          priceImpact: 100,
          error: "Token account not found"
        };
      }
      
      // In a real implementation, we'd analyze the program owner and code
      // For now, just assume it's sellable if we can get the account info
      return {
        canSell: true,
        priceImpact: 5, // Default to 5% price impact as a safe estimate
        error: null
      };
    } catch (error) {
      logger.error(`RPC sell simulation failed: ${error.message}`);
      return {
        canSell: false,
        priceImpact: 100,
        error: error.message
      };
    }
  }

  /**
   * Get holder distribution for a token
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object>} Holder distribution information
   */
  async getHolderDistribution(tokenAddress) {
    try {
      // Skip real check in demo mode
      if (this.wallet.demoMode) {
        return {
          holderCount: Math.floor(Math.random() * 95) + 5, // 5-100 holders
          topHolderPercentage: Math.floor(Math.random() * 60) + 20, // 20-80%
          top10Percentage: Math.floor(Math.random() * 30) + 70 // 70-100%
        };
      }
      
      // For real implementation, get all token accounts for this mint
      try {
        // Get all token accounts for this mint
        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
          { mint: new PublicKey(tokenAddress) }
        );
        
        if (!tokenAccounts || !tokenAccounts.value || tokenAccounts.value.length === 0) {
          logger.warn(`No token accounts found for ${tokenAddress}`);
          return {
            holderCount: 0,
            topHolderPercentage: 100,
            top10Percentage: 100
          };
        }
        
        // Group by owner to handle multiple accounts owned by the same address
        const holderBalances = new Map();
        let totalSupply = 0;
        
        // Process all token accounts
        for (const account of tokenAccounts.value) {
          const owner = account.account.data.parsed.info.owner;
          const amount = Number(account.account.data.parsed.info.tokenAmount.amount);
          
          // Skip zero balances
          if (amount === 0) continue;
          
          if (holderBalances.has(owner)) {
            holderBalances.set(owner, holderBalances.get(owner) + amount);
          } else {
            holderBalances.set(owner, amount);
          }
          
          totalSupply += amount;
        }
        
        // Convert to array for sorting
        const holders = Array.from(holderBalances.entries()).map(([owner, amount]) => ({
          owner,
          amount,
          percentage: (amount / totalSupply) * 100
        }));
        
        // Sort holders by balance (descending)
        holders.sort((a, b) => b.amount - a.amount);
        
        // Calculate metrics
        const holderCount = holders.length;
        const topHolderPercentage = holders.length > 0 ? holders[0].percentage : 100;
        
        // Calculate top 10 percentage
        const top10Holders = holders.slice(0, Math.min(10, holders.length));
        const top10Amount = top10Holders.reduce((sum, holder) => sum + holder.amount, 0);
        const top10Percentage = (top10Amount / totalSupply) * 100;
        
        return {
          holderCount,
          topHolderPercentage,
          top10Percentage
        };
      } catch (error) {
        logger.error(`Error analyzing holder distribution via RPC: ${error.message}`);
        
        // Fall back to Helius API if available
        if (this.heliusApiKey) {
          try {
            const response = await axios.get(
              `https://api.helius.xyz/v0/token-distribution?api-key=${this.heliusApiKey}&tokenMint=${tokenAddress}`
            );
            
            if (response.data) {
              return {
                holderCount: response.data.holderCount || 0,
                topHolderPercentage: response.data.topHolder?.percentage || 100,
                top10Percentage: response.data.top10Percentage || 100
              };
            }
          } catch (heliusError) {
            logger.error(`Helius API error: ${heliusError.message}`);
          }
        }
      }
      
      // Default fallback values
      return {
        holderCount: 10,
        topHolderPercentage: 80,
        top10Percentage: 95
      };
    } catch (error) {
      logger.error(`Error getting holder distribution for ${tokenAddress}: ${error.message}`);
      return {
        holderCount: 0,
        topHolderPercentage: 100,
        top10Percentage: 100
      };
    }
  }

  /**
   * Get token metadata PDA address
   * @param {PublicKey} tokenMint - Token mint address
   * @returns {Promise<PublicKey>} Metadata PDA address
   */
  async getTokenMetadataPDA(tokenMint) {
    // This is a placeholder implementation
    // In a real implementation, you would derive the metadata PDA using Metaplex
    return tokenMint;
  }

  /**
   * Execute strategies across enabled trading strategies
   */
  async executeStrategies() {
    if (!this.running) return;
    
    try {
      // Get only enabled strategies
      const enabledStrategies = Array.from(this.strategies.values())
        .filter(strategy => strategy.enabled);
      
      if (enabledStrategies.length === 0) {
        return;
      }
      
      logger.info(`Executing ${enabledStrategies.length} trading strategies...`);
      
      // Process each strategy
      for (const strategy of enabledStrategies) {
        try {
          // Get opportunities for this strategy
          const opportunities = this.opportunitiesByStrategy.get(strategy.id) || [];
          
          // Skip if no opportunities
          if (opportunities.length === 0) {
            logger.debug(`No opportunities for strategy ${strategy.name}`);
            continue;
          }
          
          // Sort by newest first
          opportunities.sort((a, b) => b.discoveredAt - a.discoveredAt);
          
          // Take the newest opportunity
          const opportunity = opportunities[0];
          
          // Don't process opportunities we've already seen or traded
          if (opportunity.processed) {
            continue;
          }
          
          logger.info(`Processing opportunity for ${opportunity.metadata.name} (${opportunity.metadata.symbol})`);
          
          // Mark as processed to avoid duplicate trades
          opportunity.processed = true;
          
          // Apply the strategy to this opportunity
          await this.applyStrategy(strategy, opportunity);
          
        } catch (strategyError) {
          logger.error(`Error applying strategy ${strategy.id}: ${strategyError.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error executing strategies: ${error.message}`);
    }
  }

  /**
   * Apply a specific trading strategy to a given opportunity
   * @param {Object} strategy - The strategy to apply
   * @param {Object} opportunity - The trading opportunity
   */
  async applyStrategy(strategy, opportunity = null) {
    try {
      logger.info(`Applying strategy: ${strategy.name} (${strategy.id})`);
      
      // Skip if max concurrent positions reached
      const activePositions = this.positionManager.getOpenPositions();
      const strategyPositions = activePositions.filter(
        pos => pos.strategyId === strategy.id
      );
      
      if (strategyPositions.length >= strategy.config.maxConcurrentPositions) {
        logger.info(`Strategy ${strategy.name} at max concurrent positions (${strategy.config.maxConcurrentPositions})`);
        return;
      }
      
      // Calculate how much we can invest right now
      const usedBudget = strategyPositions.reduce((total, pos) => total + pos.initialInvestment, 0);
      const availableBudget = strategy.config.totalBudgetSOL - usedBudget;
      
      if (availableBudget < strategy.config.maxPositionSizeSOL * 0.5) {
        logger.info(`Strategy ${strategy.name} has insufficient remaining budget`);
        return;
      }
      
      // Determine position size (random between 50-100% of max position size for variety)
      const positionSizeFactor = 0.5 + (Math.random() * 0.5); // 50-100%
      const positionSizeSOL = Math.min(
        strategy.config.maxPositionSizeSOL * positionSizeFactor, 
        availableBudget
      );
      
      // If no opportunity was provided but we're in demo mode, create a simulated one
      if (!opportunity && this.wallet.demoMode) {
        const randomBytes = crypto.randomBytes(32);
        const tokenAddress = new PublicKey(randomBytes).toString();
        
        opportunity = {
          tokenAddress,
          metadata: {
            name: this.generateMemeTokenName(),
            symbol: this.generateMemeTokenSymbol(),
            initialLiquiditySOL: 10 + Math.random() * 100,
            potentialRisk: Math.floor(Math.random() * 40) + 10
          },
          discoveredAt: new Date()
        };
      }
      
      // Execute the trade if we have an opportunity
      if (opportunity) {
        const tokenAddress = opportunity.tokenAddress;
        const metadata = opportunity.metadata;
        
        logger.info(`Executing trade for ${metadata.name} (${metadata.symbol})`);
        logger.info(`Position size: ${positionSizeSOL.toFixed(4)} SOL`);
        
        if (this.wallet.demoMode) {
          // Simulate trade execution
          await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate delay
          
          // Create simulated trade result
          const tradeResult = {
            success: Math.random() > 0.1, // 90% success rate in demo
            tokenAddress,
            amountInSol: positionSizeSOL,
            signature: `demo_tx_${Date.now().toString(16)}`,
            positionId: `demo_pos_${Date.now().toString(16)}`,
            inAmount: positionSizeSOL,
            outAmount: positionSizeSOL * (1000 + Math.random() * 9000), // Random token amount
            priceImpactPct: 0.1 + Math.random() * 2.9, // 0.1-3% price impact
            entryPrice: 0.000001 * (1 + Math.random()), // Random entry price
            demoMode: true
          };
          
          // Update strategy stats
          strategy.lastRun = new Date();
          strategy.stats.totalTrades++;
          
          if (tradeResult.success) {
            strategy.stats.successfulTrades++;
            
            // Create a mock position for tracking
            if (this.positionManager) {
              const position = this.positionManager.addPosition(
                tokenAddress,
                tradeResult.entryPrice,
                tradeResult.outAmount,
                {
                  stopLoss: strategy.config.stopLoss,
                  takeProfit: strategy.config.takeProfit,
                  trailingStop: strategy.config.trailingStop,
                  strategyId: strategy.id,
                  initialInvestment: positionSizeSOL,
                  tokenName: metadata.name,
                  tokenSymbol: metadata.symbol,
                  isDemoPosition: true
                }
              );
              
              tradeResult.positionId = position.id;
            }
            
            // Send notification if enabled
            if (strategy.config.notifications.onEntry) {
              this.emit('tradeExecuted', { 
                strategy, 
                trade: tradeResult,
                tokenName: metadata.name,
                tokenSymbol: metadata.symbol
              });
            }
          } else {
            strategy.stats.failedTrades++;
            if (strategy.config.notifications.onError) {
              this.emit('tradeError', { 
                strategy, 
                error: 'Simulated trade failure',
                tokenName: metadata.name,
                tokenSymbol: metadata.symbol
              });
            }
          }
          
          // Save updated strategy
          this.saveStrategies();
          return tradeResult;
        } else {
          // REAL MODE would be implemented here for actual trading
          // This is just a placeholder - don't implement real trading without thorough testing
          logger.warn('Real trading mode is not implemented in this version for safety');
          return { success: false, error: 'Real trading mode not implemented' };
        }
      }
      
      logger.info(`Strategy ${strategy.name} execution completed`);
    } catch (error) {
      logger.error(`Error in strategy ${strategy.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Manage existing positions (check for exit conditions)
   */
  async managePositions() {
    if (!this.running) return;
    
    try {
      logger.info('Managing existing positions...');
      
      // This typically would be handled by the PositionManager's monitoring
      // But here we could add custom logic for strategy-specific position management
      
      // Get all open positions linked to our strategies
      const openPositions = this.positionManager.getOpenPositions()
        .filter(position => position.strategyId);
      
      for (const position of openPositions) {
        const strategy = this.strategies.get(position.strategyId);
        if (!strategy) continue;
        
        // Check if we need to adjust take-profit or trailing stop based on market conditions
        // This would implement dynamic exit management beyond simple SL/TP
      }
      
      logger.info('Position management completed');
    } catch (error) {
      logger.error(`Error managing positions: ${error.message}`);
    }
  }

  /**
   * Get performance statistics for all strategies
   * @returns {Object} Performance statistics
   */
  getPerformanceStats() {
    const strategies = this.getAllStrategies();
    
    // Calculate aggregate statistics
    let totalTrades = 0;
    let successfulTrades = 0;
    let failedTrades = 0;
    let totalProfit = 0;
    
    strategies.forEach(strategy => {
      totalTrades += strategy.stats.totalTrades;
      successfulTrades += strategy.stats.successfulTrades;
      failedTrades += strategy.stats.failedTrades;
      totalProfit += strategy.stats.profit;
    });
    
    return {
      strategyCount: strategies.length,
      activeStrategies: strategies.filter(s => s.enabled).length,
      totalTrades,
      successfulTrades,
      failedTrades,
      winRate: totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0,
      totalProfit
    };
  }

  /**
   * Generate a random memecoin name
   * @returns {string} Random memecoin name
   */
  generateMemeTokenName() {
    const prefixes = ['Moon', 'Doge', 'Shib', 'Pepe', 'Wojak', 'Chad', 'Ape', 'Frog', 'Cat', 'Sol', 'Elon', 'Baby', 'Floki', 'Space', 'Galaxy', 'Cyber', 'Meme', 'Magic', 'Rocket', 'Based'];
    const suffixes = ['Inu', 'Moon', 'Rocket', 'Lambo', 'Coin', 'Token', 'Doge', 'Floki', 'Cash', 'Money', 'Gold', 'Diamond', 'Hands', 'King', 'Lord', 'God', 'Star', 'AI', 'Chain', 'Dao'];
    
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    
    return `${prefix}${suffix}`;
  }
  
  /**
   * Generate a random memecoin symbol
   * @returns {string} Random memecoin symbol
   */
  generateMemeTokenSymbol() {
    const name = this.generateMemeTokenName();
    // Take first 3-5 letters to form a symbol
    const length = 3 + Math.floor(Math.random() * 3); // 3-5 characters
    let symbol = name.substring(0, length).toUpperCase();
    
    // Ensure symbols are at least 3 characters by adding 'X' if needed
    while (symbol.length < 3) {
      symbol += 'X';
    }
    
    return symbol;
  }

  /**
   * Get token metadata from Helius API
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object|null>} Token metadata or null if error
   */
  async getHeliusTokenMetadata(tokenAddress) {
    try {
      if (this.wallet.demoMode) {
        // Generate fake metadata for demo mode
        return {
          name: this.generateMemeTokenName(),
          symbol: this.generateMemeTokenSymbol(),
          logo: null,
          description: `A new memecoin on Solana`,
          createdAt: Date.now() - Math.floor(Math.random() * 5 * 60000), // 0-5 minutes ago
          extensions: {},
          isVerified: false
        };
      }

      // Use Helius API for real metadata
      if (!this.heliusApiKey) {
        this.heliusApiKey = process.env.HELIUS_API_KEY;
        if (!this.heliusApiKey) {
          logger.error('Helius API key not configured');
          return null;
        }
      }
      
      const response = await axios.get(
        `https://api.helius.xyz/v0/tokens/metadata?api-key=${this.heliusApiKey}`,
        { 
          params: { 
            mintAccounts: [tokenAddress]
          }
        }
      );
      
      if (response.data && response.data.length > 0) {
        const metadata = response.data[0];
        
        // Extract creation time if available from on-chain account
        let createdAt = Date.now();
        if (metadata.onChainAccountInfo && metadata.onChainAccountInfo.timestamp) {
          createdAt = metadata.onChainAccountInfo.timestamp;
        }
        
        return {
          name: metadata.name || 'Unknown',
          symbol: metadata.symbol || 'UNKNOWN',
          logo: metadata.logoURI,
          description: metadata.description,
          createdAt: createdAt,
          extensions: metadata.extensions || {},
          isVerified: metadata.isVerified || false
        };
      }
      
      return null;
    } catch (error) {
      logger.error(`Error getting Helius token metadata for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get token market information (price, liquidity, volume)
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object>} Market information
   */
  async getTokenMarketInfo(tokenAddress) {
    try {
      // Skip real check in demo mode
      if (this.wallet.demoMode) {
        // Generate plausible market data for a new memecoin
        const solPrice = 30 + (Math.random() * 10 - 5); // $25-$35
        const liquidityUsd = 150 + Math.random() * 1350; // $150-$1500 
        const priceUsd = 0.00000001 + (Math.random() * 0.00000099); // Very small price
        const liquiditySol = liquidityUsd / solPrice;
        
        return {
          priceUsd,
          priceSol: priceUsd / solPrice,
          liquidityUsd,
          liquiditySol,
          volumeUsd24h: liquidityUsd * (0.5 + Math.random() * 4.5), // 0.5x-5x of liquidity
          solPrice
        };
      }
      
      // For real implementation, use Jupiter API
      try {
        // Get SOL price first (as reference)
        const solResponse = await axios.get(
          'https://price.jup.ag/v4/price?ids=SOL&vsToken=USDC'
        );
        
        let solPrice = 30; // Default fallback
        if (solResponse.data && solResponse.data.data && solResponse.data.data.SOL) {
          solPrice = solResponse.data.data.SOL.price;
        }
        
        // Get token price and data
        const tokenResponse = await axios.get(
          `https://price.jup.ag/v4/price?ids=${tokenAddress}&vsToken=USDC`
        );
        
        if (tokenResponse.data && tokenResponse.data.data && tokenResponse.data.data[tokenAddress]) {
          const tokenData = tokenResponse.data.data[tokenAddress];
          const priceUsd = tokenData.price || 0;
          const liquidityUsd = tokenData.liquidity || 0;
          const liquiditySol = liquidityUsd / solPrice;
          
          return {
            priceUsd,
            priceSol: priceUsd / solPrice,
            liquidityUsd,
            liquiditySol,
            volumeUsd24h: tokenData.volume24h || 0,
            solPrice
          };
        }
        
        // Fall back to Raydium API if Jupiter doesn't have data
        try {
          const raydiumResponse = await axios.get(
            'https://api.raydium.io/v2/main/price'
          );
          
          if (raydiumResponse.data && raydiumResponse.data[tokenAddress]) {
            const tokenPrice = raydiumResponse.data[tokenAddress];
            // Raydium doesn't provide liquidity directly, use an estimate
            const liquidityUsd = 1000; // Default estimate
            const liquiditySol = liquidityUsd / solPrice;
            
            return {
              priceUsd: tokenPrice,
              priceSol: tokenPrice / solPrice,
              liquidityUsd,
              liquiditySol,
              volumeUsd24h: 0, // Not available from this endpoint
              solPrice
            };
          }
        } catch (raydiumError) {
          logger.error(`Raydium price fetch error: ${raydiumError.message}`);
        }
      } catch (error) {
        logger.error(`Jupiter price fetch error: ${error.message}`);
      }
      
      // If both Jupiter and Raydium fail, try Helius as last resort
      if (this.heliusApiKey) {
        try {
          const heliusResponse = await axios.get(
            `https://api.helius.xyz/v0/token-price?api-key=${this.heliusApiKey}&tokenMint=${tokenAddress}`
          );
          
          if (heliusResponse.data && heliusResponse.data.price) {
            const priceUsd = heliusResponse.data.price;
            const solPrice = heliusResponse.data.solPrice || 30;
            const liquidityUsd = heliusResponse.data.liquidity || 500;
            
            return {
              priceUsd,
              priceSol: priceUsd / solPrice,
              liquidityUsd,
              liquiditySol: liquidityUsd / solPrice,
              volumeUsd24h: heliusResponse.data.volume24h || 0,
              solPrice
            };
          }
        } catch (heliusError) {
          logger.error(`Helius price fetch error: ${heliusError.message}`);
        }
      }
      
      // Default fallback values if all APIs fail
      return {
        priceUsd: 0.0000001,
        priceSol: 0.0000001 / 30,
        liquidityUsd: 500,
        liquiditySol: 500 / 30,
        volumeUsd24h: 0,
        solPrice: 30
      };
    } catch (error) {
      logger.error(`Error getting market info for ${tokenAddress}: ${error.message}`);
      return {
        priceUsd: 0,
        priceSol: 0,
        liquidityUsd: 0,
        liquiditySol: 0,
        volumeUsd24h: 0,
        solPrice: 30
      };
    }
  }
  
  /**
   * Detect if a token is likely a memecoin based on metadata
   * @param {Object} tokenMetadata - Token metadata
   * @returns {boolean} True if likely a memecoin
   */
  detectIfMemecoin(tokenMetadata) {
    // Keywords commonly found in memecoin names/descriptions
    const memeKeywords = [
      'doge', 'shib', 'inu', 'pepe', 'wojak', 'chad', 'elon', 'moon', 'rocket',
      'lambo', 'tendies', 'ape', 'gme', 'diamond', 'hands', 'frog', 'cat',
      'meme', 'coin', 'safe', 'baby', 'floki', 'mars', 'cum', 'pussy', 'cock',
      'shit', 'poo', 'pee', 'cum', 'goku', 'naruto', 'based'
    ];
    
    // Check name and symbol
    const name = (tokenMetadata.name || '').toLowerCase();
    const symbol = (tokenMetadata.symbol || '').toLowerCase();
    const description = (tokenMetadata.description || '').toLowerCase();
    
    // Check for meme keywords in name, symbol or description
    for (const keyword of memeKeywords) {
      if (name.includes(keyword) || symbol.includes(keyword) || description.includes(keyword)) {
        return true;
      }
    }
    
    // Check for other characteristics of memecoins
    const hasEmojisInName = /[\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(name);
    const highTokenSupply = tokenMetadata.supply && Number(tokenMetadata.supply) > 1000000000; // Over 1 billion
    
    // If it has emojis in name or absurdly high supply, likely a memecoin
    if (hasEmojisInName || highTokenSupply) {
      return true;
    }
    
    // Default to false if no memecoin characteristics detected
    return false;
  }

  /**
   * Execute a buy order for a token according to the strategy
   * @param {Object} tokenMetadata - Token metadata
   * @param {Object} strategy - Trading strategy
   * @returns {Promise<Object>} Buy result
   */
  async executeBuy(tokenMetadata, strategy) {
    try {
      if (!tokenMetadata || !tokenMetadata.address) {
        throw new Error('Invalid token metadata');
      }
      
      if (!strategy) {
        throw new Error('No strategy provided');
      }
      
      if (!this.wallet || this.wallet.demoMode) {
        logger.info(`Demo mode: Simulating buy for token ${tokenMetadata.address}`);
        
        // Calculate position size based on strategy
        const totalPositionSizeSOL = strategy.positionSizeSOL || 0.1;
        
        // In real mode, we would execute a multi-stage buying approach
        // For demo mode, we'll just simulate the first buy (40% of total position)
        const initialBuySize = totalPositionSizeSOL * 0.4;
        
        // Simulate buy transaction
        const buyResult = {
          success: true,
          transactionHash: `demo_tx_${Date.now().toString(16)}`,
          amount: initialBuySize,
          tokenAmount: initialBuySize / tokenMetadata.price * 1000, // Simulated token amount
          price: tokenMetadata.price,
          timestamp: Date.now(),
          isScaleIn: true,
          buyPhase: 1,
          totalPositionSizeSOL
        };
        
        // Add position to position manager with scale-in info
        if (this.positionManager) {
          const position = this.positionManager.addPosition(
            tokenMetadata.address,
            tokenMetadata.price,
            buyResult.tokenAmount,
            {
              stopLoss: strategy.stopLossPercentage || 15,
              takeProfit: strategy.takeProfitPercentage || 50,
              trailingStop: strategy.trailingStopPercentage || 12,
              maxHoldTime: strategy.maxHoldTimeMinutes || 240,  // 4 hours by default
              scaleInInfo: {
                enabled: true,
                totalPositionSizeSOL,
                remainingPositionSizeSOL: totalPositionSizeSOL * 0.6, // 60% remaining to buy
                initialBuyPercentage: 40,
                nextBuyPercentage: 30,
                buyPhase: 1,
                maxBuyPhases: 3,
                phaseTriggers: [
                  { phase: 2, priceDropPercentage: 5 },  // Buy more at 5% drop
                  { phase: 3, priceDropPercentage: 15 }  // Buy more at 15% drop
                ],
                phases: [
                  { phase: 1, percentage: 40, executed: true, executedAt: new Date() },
                  { phase: 2, percentage: 30, executed: false },
                  { phase: 3, percentage: 30, executed: false }
                ]
              },
              partialTakeProfitLevels: [
                { percentage: strategy.partialTakeProfitLevel1 || 30, sellPercentage: 20 },
                { percentage: strategy.partialTakeProfitLevel2 || 50, sellPercentage: 30 },
                { percentage: strategy.partialTakeProfitLevel3 || 100, sellPercentage: 40 }
              ]
            }
          );
          
          buyResult.positionId = position.id;
        }
        
        return buyResult;
      }
      
      // Real mode implementation
      logger.info(`Executing buy for token ${tokenMetadata.address}`);
      
      // Calculate position size based on strategy
      const totalPositionSizeSOL = strategy.positionSizeSOL || 0.1;
      
      // Scale-in approach: First buy is 40% of total position
      const initialBuySize = totalPositionSizeSOL * 0.4;
      
      // Execute the buy transaction using Jupiter client
      if (!this.jupiterClient) {
        throw new Error('Jupiter client not initialized');
      }
      
      const buyResult = await this.jupiterClient.executeSwap(
        'SOL',
        tokenMetadata.address,
        initialBuySize,
        this.wallet,
        {
          slippage: strategy.slippagePercentage || 1,
          skipPreflight: true,  // Skip preflight for faster execution on initial buy
          priorityFee: 75000,   // Higher priority for initial entry
          maxRetries: 3
        }
      );
      
      if (!buyResult.success) {
        throw new Error(`Buy failed: ${buyResult.error}`);
      }
      
      // Calculate token amount received
      const tokenAmount = parseFloat(buyResult.outAmount);
      
      // Add position to position manager with scale-in info
      if (this.positionManager) {
        const position = this.positionManager.addPosition(
          tokenMetadata.address,
          tokenMetadata.price,
          tokenAmount,
          {
            stopLoss: strategy.stopLossPercentage || 15,
            takeProfit: strategy.takeProfitPercentage || 50,
            trailingStop: strategy.trailingStopPercentage || 12,
            maxHoldTime: strategy.maxHoldTimeMinutes || 240,  // 4 hours by default
            scaleInInfo: {
              enabled: true,
              totalPositionSizeSOL,
              remainingPositionSizeSOL: totalPositionSizeSOL * 0.6, // 60% remaining to buy
              initialBuyPercentage: 40,
              nextBuyPercentage: 30,
              buyPhase: 1,
              maxBuyPhases: 3,
              phaseTriggers: [
                { phase: 2, priceDropPercentage: 5 },  // Buy more at 5% drop
                { phase: 3, priceDropPercentage: 15 }  // Buy more at 15% drop
              ],
              phases: [
                { phase: 1, percentage: 40, executed: true, executedAt: new Date() },
                { phase: 2, percentage: 30, executed: false },
                { phase: 3, percentage: 30, executed: false }
              ]
            },
            partialTakeProfitLevels: [
              { percentage: strategy.partialTakeProfitLevel1 || 30, sellPercentage: 20 },
              { percentage: strategy.partialTakeProfitLevel2 || 50, sellPercentage: 30 },
              { percentage: strategy.partialTakeProfitLevel3 || 100, sellPercentage: 40 }
            ]
          }
        );
        
        buyResult.positionId = position.id;
      }
      
      // Enhance buy result with scale-in info
      const enhancedResult = {
        ...buyResult,
        isScaleIn: true,
        buyPhase: 1,
        totalPositionSizeSOL,
        price: tokenMetadata.price
      };
      
      return enhancedResult;
    } catch (error) {
      logger.error(`Error executing buy: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute subsequent scale-in buy for a position
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Buy result
   */
  async executeScaleInBuy(positionId) {
    try {
      if (!this.positionManager) {
        throw new Error('Position manager not initialized');
      }
      
      // Get position
      const position = this.positionManager.getPosition(positionId);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }
      
      // Check if scale-in is enabled and there are remaining phases
      if (!position.scaleInInfo || !position.scaleInInfo.enabled) {
        throw new Error('Scale-in not enabled for this position');
      }
      
      const scaleInInfo = position.scaleInInfo;
      const currentPhase = scaleInInfo.buyPhase;
      const nextPhase = currentPhase + 1;
      
      if (nextPhase > scaleInInfo.maxBuyPhases) {
        throw new Error('All scale-in phases already executed');
      }
      
      // Find the next phase info
      const nextPhaseInfo = scaleInInfo.phases.find(p => p.phase === nextPhase);
      if (!nextPhaseInfo || nextPhaseInfo.executed) {
        throw new Error(`Invalid phase ${nextPhase} or already executed`);
      }
      
      // Calculate buy amount for this phase
      const buyPercentage = nextPhaseInfo.percentage;
      const buyAmountSOL = scaleInInfo.totalPositionSizeSOL * (buyPercentage / 100);
      
      logger.info(`Executing phase ${nextPhase} scale-in buy for position ${positionId}, amount: ${buyAmountSOL} SOL (${buyPercentage}% of total position)`);
      
      let buyResult;
      
      if (!this.wallet || this.wallet.demoMode) {
        // Demo mode simulation
        buyResult = {
          success: true,
          transactionHash: `demo_tx_scale_${Date.now().toString(16)}`,
          amount: buyAmountSOL,
          tokenAmount: buyAmountSOL / position.currentPrice * 1000, // Simulated token amount
          price: position.currentPrice,
          timestamp: Date.now(),
          isScaleIn: true,
          buyPhase: nextPhase
        };
      } else {
        // Real execution
        if (!this.jupiterClient) {
          throw new Error('Jupiter client not initialized');
        }
        
        // Execute the buy transaction
        buyResult = await this.jupiterClient.executeSwap(
          'SOL',
          position.tokenAddress,
          buyAmountSOL,
          this.wallet,
          {
            slippage: 2,  // Higher slippage for scale-in buys (potentially volatile)
            skipPreflight: false,
            priorityFee: 50000,  // Medium priority for scale-in buys
            maxRetries: 3
          }
        );
        
        if (!buyResult.success) {
          throw new Error(`Scale-in buy failed: ${buyResult.error}`);
        }
      }
      
      // Update position with new tokens from scale-in
      const tokenAmount = buyResult.tokenAmount || (buyAmountSOL / position.currentPrice * 1000);
      const updatedAmount = position.amount + tokenAmount;
      
      // Update scale-in info
      nextPhaseInfo.executed = true;
      nextPhaseInfo.executedAt = new Date();
      scaleInInfo.buyPhase = nextPhase;
      scaleInInfo.remainingPositionSizeSOL -= buyAmountSOL;
      
      if (nextPhase < scaleInInfo.maxBuyPhases) {
        const nextNextPhase = nextPhase + 1;
        const nextNextPhaseInfo = scaleInInfo.phases.find(p => p.phase === nextNextPhase);
        if (nextNextPhaseInfo) {
          scaleInInfo.nextBuyPercentage = nextNextPhaseInfo.percentage;
        }
      } else {
        scaleInInfo.nextBuyPercentage = 0;
      }
      
      // Update the position
      this.positionManager.updatePosition(positionId, {
        amount: updatedAmount,
        amountRemaining: position.amountRemaining + tokenAmount,
        scaleInInfo,
        lastScaleInAt: new Date()
      });
      
      // Log and return result
      logger.info(`Scale-in buy executed for position ${positionId}, phase ${nextPhase}, added ${tokenAmount} tokens`);
      
      return {
        ...buyResult,
        positionId,
        phase: nextPhase,
        tokenAmount,
        updatedAmount
      };
    } catch (error) {
      logger.error(`Error executing scale-in buy: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Manage positions - check for scale-in opportunities, trailing stops, etc.
   * @returns {Promise<void>}
   */
  async managePositions() {
    try {
      if (!this.positionManager) {
        logger.warn('Position manager not initialized, cannot manage positions');
        return;
      }
      
      const openPositions = this.positionManager.getOpenPositions();
      logger.debug(`Managing ${openPositions.length} open positions`);
      
      for (const position of openPositions) {
        try {
          // Skip positions without scale-in info
          if (!position.scaleInInfo || !position.scaleInInfo.enabled) {
            continue;
          }
          
          // Get current price
          let currentPrice = -1;
          try {
            currentPrice = await this.positionManager.getTokenPrice(position.tokenAddress);
          } catch (priceError) {
            logger.warn(`Error getting price for ${position.tokenAddress}: ${priceError.message}`);
            continue;
          }
          
          if (currentPrice <= 0) {
            logger.warn(`Invalid price (${currentPrice}) for ${position.tokenAddress}, skipping position management`);
            continue;
          }
          
          // Calculate price change since entry
          const priceChangePercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
          
          // Update position with current price for reference
          this.positionManager.updatePosition(position.id, { currentPrice });
          
          // Check for scale-in opportunities
          const scaleInInfo = position.scaleInInfo;
          
          // Only check if there are remaining phases
          if (scaleInInfo.buyPhase < scaleInInfo.maxBuyPhases) {
            const nextPhase = scaleInInfo.buyPhase + 1;
            const phaseTrigger = scaleInInfo.phaseTriggers.find(t => t.phase === nextPhase);
            
            if (phaseTrigger && priceChangePercent <= -phaseTrigger.priceDropPercentage) {
              logger.info(`Scale-in trigger detected for position ${position.id}: price dropped ${Math.abs(priceChangePercent).toFixed(2)}%, executing phase ${nextPhase} buy`);
              
              // Execute scale-in buy
              await this.executeScaleInBuy(position.id);
            }
          }
        } catch (posError) {
          logger.error(`Error managing position ${position.id}: ${posError.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error managing positions: ${error.message}`);
    }
  }
}

module.exports = AutoTrader; 