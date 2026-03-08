// Rename to config.js, add chatId and botToken

module.exports = {
  // Volume & ATR thresholds
  VOLUME_MULTIPLIER: 3,      // 3x volume spike
  ATR_THRESHOLD: 1.5,        // 1.5% ATR minimum
  CHECK_INTERVAL: 60000,     // 1 minute in ms

  // Timeframes to monitor
  TIMEFRAMES: ['1m', '5m', '15m'],

  // Exchanges
  EXCHANGES: ['bybit', 'mexc'],

  // Telegram alerts
  TELEGRAM: {
    enabled: true,
    chatId: 'YOUR_CHAT_ID',  // Your Telegram chat ID
    botToken: 'YOUR_BOT_TOKEN'  // Set this from BotFather
  },

  // Top tokens count for /atr, /volume, /price commands
  TOP_NUMBER: 5,

  // Minimum volume in USDT to consider (filter dust)
  MIN_VOLUME_USDT: 10000
};
