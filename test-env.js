// test-env.js
require('dotenv').config();
console.log('TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? 'Exists' : 'Missing');
console.log('ADMIN_TELEGRAM_IDS:', process.env.ADMIN_TELEGRAM_IDS);
console.log('DEMO_WALLET_ADDRESS:', process.env.DEMO_WALLET_ADDRESS);