# TraderTony v3 - Solana Trading Bot

TraderTony v3 is an advanced Telegram bot for Solana trading with powerful features for token sniping, analysis, and portfolio management.

![TraderTony Bot](public/Untitled%20design%20(1).png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-14151A?logo=solana&logoColor=00FFA3)](https://solana.com/)
[![Jupiter](https://img.shields.io/badge/Jupiter_DEX-Connected-brightgreen)](https://jup.ag/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-blue?logo=telegram)](https://telegram.org/)
[![Phantom](https://img.shields.io/badge/Phantom-Integrated-purple?logo=phantom)](https://phantom.app/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org/)
[![AutoTrader](https://img.shields.io/badge/AutoTrader-24/7-orange)](https://github.com/tony-42069/trader-tony-v3)

## Features

- 🚀 **SNIPERTONY** - Advanced Precision Trading
  - MEV-protected transactions
  - Custom gas optimization
  - Smart contract analysis & risk detection
  - Auto Take-Profit/Stop-Loss management

- ⚡ **Ultra-Fast Execution Suite**
  - Lightning-quick token sniping
  - Anti-rug protection system
  - Slippage control & front-run defense
  - Multi-DEX liquidity monitoring

- 💼 **Professional Trading Features**
  - Real-time price impact analysis
  - Advanced charting integration
  - Holder distribution tracking
  - Volume & liquidity alerts

- 🔒 **Enterprise-Grade Security**
  - Secure wallet integration
  - Transaction signing verification
  - Anti-MEV transaction routing
  - Real-time risk assessment

- 🌐 **Phantom Wallet Integration**
  - QR code generation for deposits
  - Solana Pay integration
  - Easy withdrawals to Phantom wallet
  - Secure transaction signing

- 🤖 **24/7 Autonomous Trading**
  - Configure multiple trading strategies
  - Automatic risk assessment and position sizing
  - Set custom entry/exit conditions
  - Event-based notifications
  - Historical performance tracking

## Quick Start

### Prerequisites
- Node.js 18+ installed
- Telegram account
- Telegram Bot Token (from BotFather)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/tony-42069/trader-tony-v3.git
   cd trader-tony-v3
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your configuration:
   ```
   # Telegram Configuration
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   ADMIN_TELEGRAM_IDS=your_telegram_id
   
   # Solana Configuration (Recommend Testnet for initial setup)
   SOLANA_RPC_URL=https://api.testnet.solana.com 
   # Add your private key for transaction signing (required for non-demo mode)
   SOLANA_PRIVATE_KEY=your_base58_private_key 
   
   # Wallet Configuration
   DEMO_MODE=true
   DEMO_WALLET_ADDRESS=your_wallet_address
   
   # Default Settings
   DEFAULT_SLIPPAGE=10
   DEFAULT_GAS_PRICE=30
   DEFAULT_STOP_LOSS=25
   DEFAULT_TAKE_PROFIT=50
   ```

4. Start the bot:
   ```
   node src/reset-and-start.js
   ```

## Usage

### Available Commands

- `/start` - Start or restart the bot
- `/help` - Display help information
- `/balance` - Check your wallet balance
- `/autotrader` - Manage autonomous trading strategies
- `/addstrategy` - Create a new trading strategy

### Main Features

- **Buy** - Enter a token address to buy with customizable slippage
- **Fund** - View funding options including Phantom wallet deposits
- **Monitor** - Track token prices and set alerts with customizable thresholds
- **Positions** - View current token positions and performance
- **Wallet** - View wallet information and token holdings
- **Settings** - Configure trading parameters and preferences
- **AutoTrader** - Configure and manage automated 24/7 trading strategies
- **Phantom Connect** - Deposit and withdraw using Phantom wallet

## Implemented Features

- ✅ Real-time token price monitoring
- ✅ Jupiter DEX integration for token swaps
- ✅ Basic token risk analysis
- ✅ Price alert system
- ✅ Position tracking with automatic updates
- ✅ Phantom wallet integration for deposits/withdrawals
- ✅ Solana Pay and QR code generation
- ✅ Real wallet connection with transaction signing
- ✅ 24/7 Autonomous trading with custom strategies 
- 🚧 **Currently Undergoing Testnet Validation:** Core trading and position management features (SL/TP, Trailing, Partials, Scale-in) are implemented but require full validation on Testnet. See `DEBUGGING_REPORT.md` for current status.

## Development

### Project Structure

```
trader-tony-v3/
├── src/
│   ├── commands/       # Command handlers
│   ├── keyboards/      # Telegram keyboard layouts
│   ├── utils/          # Utility functions
│   │   ├── phantom.js  # Phantom wallet integration
│   │   ├── jupiter.js  # Jupiter DEX integration
│   │   └── solana.js   # Solana blockchain utilities
│   ├── trading/        # Trading functionality
│   │   ├── auto-trader.js  # Autonomous trading engine
│   │   ├── position-manager.js  # Position management
│   │   ├── risk-analyzer.js  # Risk analysis
│   │   └── sniper.js  # Token sniping
│   ├── index.js        # Main bot entry point
│   └── reset-and-start.js  # Script to reset webhook and start bot
├── logs/               # Log files
├── data/               # Persistent data storage
├── ROADMAP.md          # Development roadmap
├── .env                # Environment variables
└── package.json        # Dependencies
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Disclaimer

This software is for educational purposes only. Use at your own risk. Trading cryptocurrencies involves substantial risk and is not suitable for all investors. The autonomous trading feature should be used with caution and appropriate risk management.
