// Rename to config.js, add chatId and botToken

module.exports = {
  // Volume & ATR thresholds
  ALERT_VOLUME_THRESHOLD: 3,      // 3x volume spike
  ALERT_ATR_THRESHOLD: 1.5,        // 1.5% ATR minimum
  ALERT_PRICE_THRESHOLD: 5,           // 5% price change threshold
  ALERT_FUNDING_THRESHOLD: 0.1,       // 0.1% absolute funding rate threshold

  // Alert timeframes (in minutes)
  ALERT_VOLUME_TF: 20,       // Compare volume over last N minutes
  ALERT_ATR_TF: 5,           // ATR calculation timeframe in minutes
  ALERT_PRICE_TF: 60,        // Price change over last N minutes

  CHECK_INTERVAL: 60000,     // 1 minute in ms

  // Timeframes to monitor
  TIMEFRAMES: ['1m', '5m', '15m'],

  // Exchanges
  EXCHANGES: ['bybit', 'bybit_spot', 'mexc', 'mexc_spot', 'gate', 'gate_spot', 'okx', 'okx_spot', 'htx', 'htx_spot'],

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
