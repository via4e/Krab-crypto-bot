const BybitAPI = require('./exchanges/bybit');
const MEXCAPI = require('./exchanges/mexc');
const MEXCPerpAPI = require('./exchanges/mexc_perp');
const config = require('./config');
const { Telegraf } = require('telegraf');

// Escape helper for Telegram Markdown v1
const escapeMd = (str) => typeof str === 'string' ? str.replace(/_/g, '\\_') : str;

// Simple delay helper for rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class CryptoTracker {
  constructor() {
    this.exchanges = {
      bybit: { api: new BybitAPI(), name: 'Bybit' },
      mexc: { api: new MEXCAPI(), name: 'MEXC' },
      mexc_perp: { api: new MEXCPerpAPI(), name: 'MEXC_PERP' }
    };
    this.volumeHistory = {};
    this.alertedSymbols = new Set();

    if (config.TELEGRAM.enabled && config.TELEGRAM.botToken) {
      this.tgBot = new Telegraf(config.TELEGRAM.botToken);

      // Handle /status command
      this.tgBot.command('status', (ctx) => {
        ctx.reply('🟢 Online');
      });

      // Handle /atr command — top tokens by 5m ATR
      this.tgBot.command('atr', async (ctx) => {
        await this.sendTopATR(ctx.chat.id);
      });

      // Handle /volume command — top tokens by 1h volume change
      this.tgBot.command('volume', async (ctx) => {
        await this.sendTopVolume(ctx.chat.id);
      });

      // Handle /price command — top tokens by 6h price change
      this.tgBot.command('price', async (ctx) => {
        await this.sendTopPrice(ctx.chat.id);
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

  // Get volume ratio for a symbol
  getVolumeRatio(symbol) {
    const history = this.volumeHistory[symbol];
    if (!history || history.length === 0) return 0;
    const avgVol = history.reduce((a, b) => a + b, 0) / history.length;
    return history[history.length - 1] / avgVol;
  }

  // Get top N tokens by ATR on a given timeframe across all exchanges
  async getTopATR(timeframe = '5m', topN = config.TOP_NUMBER) {
    const results = [];

    for (const key of config.EXCHANGES) {
      const ex = this.exchanges[key];
      if (!ex) continue;

      try {
        const symbols = await ex.api.getSymbols();
        const tickers = await ex.api.getTickers();

        for (const symbol of symbols.slice(0, 100)) {
          const ticker = tickers[symbol];
          if (!ticker || ticker.volume24h < config.MIN_VOLUME_USDT) continue;

          try {
            const candles = await ex.api.getKlines(symbol, timeframe);
            if (candles.length < 20) continue;

            const atr = this.calculateATR(candles);
            if (atr !== null) {
              results.push({
                symbol,
                exchange: ex.name,
                atr,
                price: ticker.lastPrice
              });
            }
          } catch (e) {
            // Skip individual symbol errors
          }

          await delay(100);
        }
      } catch (err) {
        console.error(`❌ Error fetching ATR from ${ex.name}:`, err.message);
      }
    }

    return results.sort((a, b) => b.atr - a.atr).slice(0, topN);
  }

  // Send top ATR response to Telegram
  async sendTopATR(chatId) {
    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(chatId, '🔍 Scanning for top ATR tokens...');
    }

    try {
      const top = await this.getTopATR('5m');

      if (top.length === 0) {
        if (this.tgBot) {
          await this.tgBot.telegram.sendMessage(chatId, '⚠️ No ATR data found.');
        }
        return;
      }

      const lines = top.map((t, i) =>
        `${i + 1}. *${escapeMd(t.symbol)}* (${escapeMd(t.exchange)})\n   ATR: ${t.atr.toFixed(2)}% | Price: $${t.price}`
      );

      const message = `🦀 *Top ${config.TOP_NUMBER} ATR (5m)*\n\n` + lines.join('\n\n');

      if (this.tgBot) {
        await this.tgBot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error('❌ Error in /atr command:', err.message);
      if (this.tgBot) {
        await this.tgBot.telegram.sendMessage(chatId, '❌ Error fetching ATR data.');
      }
    }
  }

  // Get top N tokens by volume change in last hour across all exchanges
  async getTopVolume(topN = config.TOP_NUMBER) {
    const results = [];

    for (const key of config.EXCHANGES) {
      const ex = this.exchanges[key];
      if (!ex) continue;

      try {
        const symbols = await ex.api.getSymbols();
        const tickers = await ex.api.getTickers();

        for (const symbol of symbols.slice(0, 100)) {
          const ticker = tickers[symbol];
          if (!ticker || ticker.volume24h < config.MIN_VOLUME_USDT) continue;

          try {
            // Get 1m candles for last hour (60 candles)
            const candles = await ex.api.getKlines(symbol, '1m', 60);
            if (candles.length < 60) continue;

            // Compare first half vs second half volume
            const firstHalf = candles.slice(0, 30);
            const secondHalf = candles.slice(30);
            const firstVol = firstHalf.reduce((sum, c) => sum + c.volume, 0);
            const secondVol = secondHalf.reduce((sum, c) => sum + c.volume, 0);

            if (firstVol === 0) continue;
            const changePercent = ((secondVol - firstVol) / firstVol) * 100;

            results.push({
              symbol,
              exchange: ex.name,
              changePercent,
              price: ticker.lastPrice
            });
          } catch (e) {
            // Skip individual symbol errors
          }

          await delay(100);
        }
      } catch (err) {
        console.error(`❌ Error fetching volume from ${ex.name}:`, err.message);
      }
    }

    return results.sort((a, b) => b.changePercent - a.changePercent).slice(0, topN);
  }

  // Send top volume change response to Telegram
  async sendTopVolume(chatId) {
    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(chatId, '🔍 Scanning for top volume changes...');
    }

    try {
      const top = await this.getTopVolume();

      if (top.length === 0) {
        if (this.tgBot) {
          await this.tgBot.telegram.sendMessage(chatId, '⚠️ No volume data found.');
        }
        return;
      }

      const lines = top.map((t, i) =>
        `${i + 1}. *${escapeMd(t.symbol)}* (${escapeMd(t.exchange)})\n   Volume: ${t.changePercent >= 0 ? '+' : ''}${t.changePercent.toFixed(1)}% | Price: $${t.price}`
      );

      const message = `📊 *Top ${config.TOP_NUMBER} Volume Change (1h)*\n\n` + lines.join('\n\n');

      if (this.tgBot) {
        await this.tgBot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error('❌ Error in /volume command:', err.message);
      if (this.tgBot) {
        await this.tgBot.telegram.sendMessage(chatId, '❌ Error fetching volume data.');
      }
    }
  }

  // Get top N tokens by price change in last 6 hours across all exchanges
  async getTopPrice(topN = config.TOP_NUMBER) {
    const results = [];

    for (const key of config.EXCHANGES) {
      const ex = this.exchanges[key];
      if (!ex) continue;

      try {
        const symbols = await ex.api.getSymbols();
        const tickers = await ex.api.getTickers();

        for (const symbol of symbols.slice(0, 100)) {
          const ticker = tickers[symbol];
          if (!ticker || ticker.volume24h < config.MIN_VOLUME_USDT) continue;

          try {
            // Get 1h candles for last 6 hours (6 candles)
            const candles = await ex.api.getKlines(symbol, '1h', 6);
            if (candles.length < 2) continue;

            const openPrice = candles[0].open;
            const closePrice = candles[candles.length - 1].close;

            if (openPrice === 0) continue;
            const changePercent = ((closePrice - openPrice) / openPrice) * 100;

            results.push({
              symbol,
              exchange: ex.name,
              changePercent,
              openPrice,
              closePrice
            });
          } catch (e) {
            // Skip individual symbol errors
          }

          await delay(100);
        }
      } catch (err) {
        console.error(`❌ Error fetching price data from ${ex.name}:`, err.message);
      }
    }

    // Sort by absolute price change descending (biggest movers)
    return results.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, topN);
  }

  // Send top price change response to Telegram
  async sendTopPrice(chatId) {
    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(chatId, '🔍 Scanning for top price movers...');
    }

    try {
      const top = await this.getTopPrice();

      if (top.length === 0) {
        if (this.tgBot) {
          await this.tgBot.telegram.sendMessage(chatId, '⚠️ No price data found.');
        }
        return;
      }

      const lines = top.map((t, i) => {
        const arrow = t.changePercent >= 0 ? '🟢' : '🔴';
        const sign = t.changePercent >= 0 ? '+' : '';
        return `${i + 1}. ${arrow} *${escapeMd(t.symbol)}* (${escapeMd(t.exchange)})\n   ${sign}${t.changePercent.toFixed(2)}% | $${t.openPrice} → $${t.closePrice}`;
      });

      const message = `💰 *Top ${config.TOP_NUMBER} Price Change (6h)*\n\n` + lines.join('\n\n');

      if (this.tgBot) {
        await this.tgBot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error('❌ Error in /price command:', err.message);
      if (this.tgBot) {
        await this.tgBot.telegram.sendMessage(chatId, '❌ Error fetching price data.');
      }
    }
  }

  // Send Telegram alert
  async sendAlert(exchange, symbol, atrData, volumeRatio) {
    const message = '🦀 *VOLUME SPIKE ALERT*\n\n' +
      `Exchange: ${escapeMd(exchange.toUpperCase())}\n` +
      `Symbol: ${escapeMd(symbol)}\n` +
      `Volume: ${volumeRatio.toFixed(2)}x average\n` +
      `ATR:\n${atrData.map(a => `  ${a.tf}: ${a.atr.toFixed(2)}%`).join('\n')}\n\n` +
      `Check it before the crowd!`;

    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(config.TELEGRAM.chatId, message, {
        parse_mode: 'Markdown'
      });
    }
    console.log(`🚨 ALERT: ${symbol} on ${exchange}`);
  }

  // Scan one exchange
  async scanExchange(exchangeKey, api, name) {
    try {
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
            // Skip individual kline errors
          }
        }

        // Alert if conditions met
        if (volumeSpike && atrData.length > 0) {
          const key = `${exchangeKey}:${symbol}`;
          if (!this.alertedSymbols.has(key)) {
            const volRatio = this.getVolumeRatio(symbol);

            await this.sendAlert(exchangeKey, symbol, atrData, volRatio);
            this.alertedSymbols.add(key);

            // Clear after 30 min
            setTimeout(() => this.alertedSymbols.delete(key), 1800000);
          }
        }

        // Rate limit: small delay between symbols
        await delay(100);
      }
    } catch (err) {
      console.error(`❌ Error scanning ${name}:`, err.message);
    }
  }

  // Main loop
  start() {
    console.log('🦀 Krab Tracker started...');
    console.log(`Volume: ${config.VOLUME_MULTIPLIER}x | ATR: ${config.ATR_THRESHOLD}% | Interval: ${config.CHECK_INTERVAL / 1000}s`);

    const scan = async () => {
      for (const key of config.EXCHANGES) {
        const ex = this.exchanges[key];
        if (ex) {
          await this.scanExchange(key, ex.api, ex.name);
        } else {
          console.warn(`⚠️ Unknown exchange in config: ${key}`);
        }
      }
    };

    // Run immediately, then repeat on interval
    scan();
    setInterval(scan, config.CHECK_INTERVAL);
  }
}

// Start
const tracker = new CryptoTracker();
tracker.start();

// Launch Telegraf polling with built-in graceful shutdown
if (tracker.tgBot) {
  // Send startup message
  tracker.tgBot.telegram.sendMessage(
    config.TELEGRAM.chatId,
    '🦀 *Krab Tracker Online*\n' +
    `Volume: ${config.VOLUME_MULTIPLIER}x | ATR: ${config.ATR_THRESHOLD}%\n` +
    `Scanning: ${escapeMd(config.EXCHANGES.join(', ').toUpperCase())}\n` +
    `Interval: ${config.CHECK_INTERVAL / 1000}s\n` +
    `Commands: /status /atr /volume /price`,
    { parse_mode: 'Markdown' }
  ).catch(err => console.error('❌ Failed to send startup message:', err.message));

  // Register bot command menu (shows in the "/" button in Telegram)
  tracker.tgBot.telegram.setMyCommands([
    { command: 'status', description: 'Check if the bot is online' },
    { command: 'atr', description: 'Top tokens by ATR on 5m timeframe' },
    { command: 'volume', description: 'Top tokens by volume change (last 1h)' },
    { command: 'price', description: 'Top tokens by price change (last 6h)' },
  ]).catch(err => console.error('❌ Failed to set bot commands:', err.message));

  tracker.tgBot.launch();

  // Graceful shutdown — stop polling to prevent 409 Conflict on restart
  process.once('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    tracker.tgBot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    console.log('\n🛑 Shutting down...');
    tracker.tgBot.stop('SIGTERM');
  });
}
