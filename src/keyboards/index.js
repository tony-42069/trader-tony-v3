// Keyboard layouts for the TraderTony v3 bot
const { Markup } = require('telegraf');

// Main keyboard with all primary functions
const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🚀 Snipe', callback_data: 'snipe' },
        { text: '💰 Buy', callback_data: 'buy' }
      ],
      [
        { text: '💵 Fund', callback_data: 'fund' },
        { text: '📊 Monitor', callback_data: 'monitor' }
      ],
      [
        { text: '📈 Positions', callback_data: 'positions' },
        { text: '👛 Wallet', callback_data: 'wallet' }
      ],
      [
        { text: '🎯 Limit Orders', callback_data: 'limitOrders' },
        { text: '⚙️ Settings', callback_data: 'settings' }
      ],
      [
        { text: '🤖 AutoTrader', callback_data: 'autotrader' },
        { text: '🔄 Refresh', callback_data: 'refresh' }
      ]
    ]
  }
};

// Slippage selection keyboard
const slippageKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '0.5%', callback_data: 'slippage_0.5' },
        { text: '1%', callback_data: 'slippage_1' },
        { text: '2%', callback_data: 'slippage_2' }
      ],
      [
        { text: '5%', callback_data: 'slippage_5' },
        { text: '10%', callback_data: 'slippage_10' },
        { text: '15%', callback_data: 'slippage_15' }
      ],
      [
        { text: 'Cancel', callback_data: 'cancel_snipe' }
      ]
    ]
  }
};

// Fund keyboard
const fundKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📱 Deposit from Phantom', callback_data: 'deposit_phantom' }
      ],
      [
        { text: '💸 Withdraw to Phantom', callback_data: 'withdraw_phantom' }
      ],
      [
        { text: 'MoonPay', url: 'https://www.moonpay.com/buy/sol' }
      ],
      [
        { text: 'Copy Address', callback_data: 'copy_address' }
      ],
      [
        { text: '« Back', callback_data: 'refresh' }
      ]
    ]
  }
};

// Phantom deposit keyboard with QR code option
const phantomDepositKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📲 Generate QR Code', callback_data: 'generate_qr' }
      ],
      [
        { text: '📋 Copy Solana Pay Link', callback_data: 'copy_pay_link' }
      ],
      [
        { text: '« Back to Funding Options', callback_data: 'fund' }
      ]
    ]
  }
};

// Phantom withdraw keyboard
const phantomWithdrawKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '0.1 SOL', callback_data: 'withdraw_0.1' }
      ],
      [
        { text: '0.5 SOL', callback_data: 'withdraw_0.5' }
      ],
      [
        { text: '1 SOL', callback_data: 'withdraw_1' }
      ],
      [
        { text: '« Back to Funding Options', callback_data: 'fund' }
      ]
    ]
  }
};

// Wallet keyboard
const walletKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'View on Solscan', url: 'https://solscan.io/' }
      ],
      [
        { text: 'Send SOL', callback_data: 'send_sol' },
        { text: 'Send Token', callback_data: 'send_token' }
      ],
      [
        { text: '« Back', callback_data: 'refresh' }
      ]
    ]
  }
};

// Settings keyboard
const settingsKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'Default Slippage', callback_data: 'set_slippage' }
      ],
      [
        { text: 'Default Gas', callback_data: 'set_gas' }
      ],
      [
        { text: 'Stop-Loss', callback_data: 'set_stop_loss' }
      ],
      [
        { text: 'Take-Profit', callback_data: 'set_take_profit' }
      ],
      [
        { text: '« Back', callback_data: 'refresh' }
      ]
    ]
  }
};

// Limit order keyboard
const limitOrderKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'Create Limit Buy', callback_data: 'create_limit_buy' }
      ],
      [
        { text: 'Create Limit Sell', callback_data: 'create_limit_sell' }
      ],
      [
        { text: '« Back', callback_data: 'refresh' }
      ]
    ]
  }
};

// DCA order keyboard
const dcaOrderKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'Create DCA Order', callback_data: 'create_dca' }
      ],
      [
        { text: '« Back', callback_data: 'refresh' }
      ]
    ]
  }
};

// Back to main keyboard
const backToMainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '« Back to Main Menu', callback_data: 'refresh' }
      ]
    ]
  }
};

// Stop-loss and take-profit keyboard
const stopLossTakeProfitKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'SL: 10% / TP: 20%', callback_data: 'sl_tp_10_20' },
        { text: 'SL: 15% / TP: 30%', callback_data: 'sl_tp_15_30' }
      ],
      [
        { text: 'SL: 20% / TP: 40%', callback_data: 'sl_tp_20_40' },
        { text: 'SL: 25% / TP: 50%', callback_data: 'sl_tp_25_50' }
      ],
      [
        { text: 'Skip for now', callback_data: 'skip_sl_tp' }
      ]
    ]
  }
};

// AutoTrader keyboard
const autoTraderKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '▶️ Start Trading', callback_data: 'start_autotrader' },
        { text: '⏹️ Stop Trading', callback_data: 'stop_autotrader' }
      ],
      [
        { text: '📊 View Strategies', callback_data: 'view_strategies' },
        { text: '➕ Add Strategy', callback_data: 'add_strategy' }
      ],
      [
        { text: '📈 Performance', callback_data: 'autotrader_performance' },
        { text: '⚙️ Settings', callback_data: 'autotrader_settings' }
      ],
      [
        { text: '« Back to Main Menu', callback_data: 'refresh' }
      ]
    ]
  }
};

module.exports = {
  mainKeyboard,
  slippageKeyboard,
  stopLossTakeProfitKeyboard,
  fundKeyboard,
  walletKeyboard,
  settingsKeyboard,
  limitOrderKeyboard,
  dcaOrderKeyboard,
  backToMainKeyboard,
  phantomDepositKeyboard,
  phantomWithdrawKeyboard,
  autoTraderKeyboard
};