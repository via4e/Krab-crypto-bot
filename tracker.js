const BybitAPI = require('./exchanges/bybit');
const MEXCAPI = require('./exchanges/mexc');
const config = require('./config');
const TelegramBot = require('node-telegram-bot-api');

class CryptoTracker {
  constructor() {
    this.bybit = new BybitAPI();
    this.mexc = new MEXCAPI();
    this.volumeHistory = {};
    this.alertedSymbols = new Set();
    
    if (config.TELEGRAM.enabled && config.TELEGRAM.botToken) {
      this.tgBot = new TelegramBot(config.TELEGRAM.botToken, { polling: true });
      
      // Send startup message
      this.tgBot.sendMessage(config.TELEGRAM.chatId, 
        '🦀 **Krab Tracker Online**'
  +
        `Volume: ${config.VOLUME_MULTIPLIER}x | ATR: ${config.ATR_THRESHOLD}%
` +
        `Scanning: ${config.EXCHANGES.join(', ').toUpperCase()}
` +
        `Interval: ${config.CHECK_INTERVAL/1000}s
` +
        `Use /status to check bot online`);
      
      // Handle /status command
      this.tgBot.onText(/\/status/, (msg) => {
        this.tgBot.sendMessage(config.TELEGRAM.chatId, '🟢 Online');
      });
    }
  }

  // Calculate ATR (Average True Range)
  calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trValues.push(tr);
    }
    
    const atr = trValues.slice(-period).reduce((a, b) => a + b, 0) / period;
    const currentPrice = candles[candles.length - 1].close;
    return (atr / currentPrice) * 100;
  }

  // Check volume anomaly
  checkVolumeAnomaly(symbol, currentVolume) {
    if (!this.volumeHistory[symbol]) {
      this.volumeHistory[symbol] = [];
    }
    
    this.volumeHistory[symbol].push(currentVolume);
    if (this.volumeHistory[symbol].length > 100) {
      this.volumeHistory[symbol].shift();
    }
    
    if (this.volumeHistory[symbol].length < 20) return false;
    
    const avgVolume = this.volumeHistory[symbol].reduce((a, b) => a + b, 0) / 
                      this.volumeHistory[symbol].length;
    const ratio = currentVolume / avgVolume;
    
    return ratio >= config.VOLUME_MULTIPLIER;
  }
  // Send Telegram alert
  async sendAlert(exchange, symbol, atrData, volumeRatio) {
    const message = `🦀 **VOLUME SPIKE ALERT**

` +
      `Exchange: ${exchange.toUpperCase()}
` +
      `Symbol: ${symbol}
` +
      `Volume: ${volumeRatio.toFixed(2)}x average
` +
      `ATR: ${atrData.map(a => `  ${a.tf}: ${a.atr.toFixed(2)}%`).join('')}
` +
      `Check it before the crowd!`;
    
    if (this.tgBot) {
      await this.tgBot.sendMessage(config.TELEGRAM.chatId, message, {
        parse_mode: 'Markdown'
      });
    }
    console.log(`🚨 ALERT: ${symbol} on ${exchange}`);
  }

  // Scan one exchange
  async scanExchange(exchange, api, name) {
    console.log(`Scanning ${name}...`);
    const symbols = await api.getSymbols();
    const tickers = await api.getTickers();
    
    for (const symbol of symbols.slice(0, 100)) {
      const ticker = tickers[symbol];
      if (!ticker || ticker.volume24h < config.MIN_VOLUME_USDT) continue;
      
      const atrData = [];
      let volumeSpike = false;
      
      for (const tf of config.TIMEFRAMES) {
        try {
          const candles = await api.getKlines(symbol, tf);
          if (candles.length < 20) continue;
          
          const atr = this.calculateATR(candles);
          const lastCandle = candles[candles.length - 1];
          
          if (atr !== null && atr >= config.ATR_THRESHOLD) {
            atrData.push({ tf, atr });
          }
          
          if (tf === '1m' && this.checkVolumeAnomaly(symbol, lastCandle.volume)) {
            volumeSpike = true;
          }
        } catch (e) {
          // Skip errors
        }
      }
      // Alert if conditions met
      if (volumeSpike && atrData.length > 0) {
        const key = `${exchange}:${symbol}`;
        if (!this.alertedSymbols.has(key)) {
          const volRatio = this.volumeHistory[symbol] ? 
            (lastCandle.volume / (this.volumeHistory[symbol].reduce((a,b)=>a+b,0) / 
            this.volumeHistory[symbol].length)) : 0;
          
          await this.sendAlert(exchange, symbol, atrData, volRatio);
          this.alertedSymbols.add(key);
          
          // Clear after 30 min
          setTimeout(() => this.alertedSymbols.delete(key), 1800000);
        }
      }
    }
  }

  // Main loop
  start() {
    console.log('🦀 Krab Tracker started...');
    console.log(`Volume: ${config.VOLUME_MULTIPLIER}x | ATR: ${config.ATR_THRESHOLD}% | Interval: ${config.CHECK_INTERVAL/1000}s`);
    
    setInterval(async () => {
      await this.scanExchange('bybit', this.bybit, 'Bybit');
      await this.scanExchange('mexc', this.mexc, 'MEXC');
    }, config.CHECK_INTERVAL);
  }
}

// Start
const tracker = new CryptoTracker();
tracker.start();
