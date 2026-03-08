const BybitAPI = require('./exchanges/bybit');
const BybitSpotAPI = require('./exchanges/bybit_spot');
const MEXCAPI = require('./exchanges/mexc'); // formerly mexc_perp
const MEXCSpotAPI = require('./exchanges/mexc_spot'); // formerly mexc
const GateAPI = require('./exchanges/gate'); // formerly gate_perp
const GateSpotAPI = require('./exchanges/gate_spot'); // formerly gate
const OKXAPI = require('./exchanges/okx');
const OKXSpotAPI = require('./exchanges/okx_spot');
const HTXAPI = require('./exchanges/htx');
const HTXSpotAPI = require('./exchanges/htx_spot');
const config = require('./config');
const DB = require('./db');
const { Telegraf } = require('telegraf');

// Escape helper for Telegram Markdown v1
const escapeMd = (str) => typeof str === 'string' ? str.replace(/_/g, '\\_') : str;

// Calculate nearest future 8h UTC boundary (00:00, 08:00, 16:00)
const getDefaultFundingTime = (nowMs = Date.now()) => {
  const intervalMs = 8 * 3600 * 1000;
  return Math.ceil(nowMs / intervalMs) * intervalMs;
};

// Format funding rate with cycle and countdown
const formatFundingObj = (rateObj) => {
  const rateVal = typeof rateObj === 'number' ? rateObj : (rateObj && rateObj.rate !== undefined ? rateObj.rate : 0);
  if (rateVal === null) return null;
  const cycleHs = (rateObj && rateObj.intervalHours) ? rateObj.intervalHours : 8;
  const nextTime = (rateObj && rateObj.nextFundingTime) ? rateObj.nextFundingTime : getDefaultFundingTime();

  const diffMs = nextTime - Date.now();
  if (diffMs < 0) return `${(rateVal * 100).toFixed(4)}% each ${cycleHs}h, next soon`;
  
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffMins = Math.floor((diffMs % 3600000) / 60000);
  
  let timeStr = '';
  if (diffHrs > 0) timeStr += `${diffHrs}h `;
  timeStr += `${diffMins}m`;
  if (timeStr === '0m') timeStr = '<1m';
  
  return `${(rateVal * 100).toFixed(4)}% each ${cycleHs}h, next ${timeStr.trim()}`;
};

// Simple delay helper for rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class CryptoTracker {
  constructor() {
    this.exchanges = {
      bybit: { api: new BybitAPI(), name: 'Bybit' },
      bybit_spot: { api: new BybitSpotAPI(), name: 'Bybit Spot' },
      mexc: { api: new MEXCAPI(), name: 'MEXC' },
      mexc_spot: { api: new MEXCSpotAPI(), name: 'MEXC Spot' },
      gate: { api: new GateAPI(), name: 'Gate' },
      gate_spot: { api: new GateSpotAPI(), name: 'Gate Spot' },
      okx: { api: new OKXAPI(), name: 'OKX' },
      okx_spot: { api: new OKXSpotAPI(), name: 'OKX Spot' },
      htx: { api: new HTXAPI(), name: 'HTX' },
      htx_spot: { api: new HTXSpotAPI(), name: 'HTX Spot' }
    };
    this.volumeHistory = {};
    this.alertedSymbols = new Set();

    if (config.TELEGRAM.enabled && config.TELEGRAM.botToken) {
      this.tgBot = new Telegraf(config.TELEGRAM.botToken);

      // Handle /status command
      this.tgBot.command('status', (ctx) => {
        ctx.reply('🟢 Online, scannig every ' + config.CHECK_INTERVAL / 1000 + 's');
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

      // Handle /funding command — top perpetual tokens by funding rate
      this.tgBot.command('funding', async (ctx) => {
        await this.sendTopFunding(ctx.chat.id);
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

    // Must have at least 20 historical candles before we can compare
    if (this.volumeHistory[symbol].length < 20) {
      this.volumeHistory[symbol].push(currentVolume);
      return false;
    }

    // Calculate average of HISTORY (excluding current spike)
    const avgVolume = this.volumeHistory[symbol].reduce((a, b) => a + b, 0) /
      this.volumeHistory[symbol].length;
      
    const ratio = currentVolume / avgVolume;

    // Now update history for future checks
    this.volumeHistory[symbol].push(currentVolume);
    if (this.volumeHistory[symbol].length > 100) {
      this.volumeHistory[symbol].shift(); // Keep last 100
    }

    return ratio;
  }

  // Get volume ratio for a symbol (calculates against history excluding the latest pushed if it was just pushed)
  getVolumeRatio(symbol, currentVolume) {
    const history = this.volumeHistory[symbol];
    if (!history || history.length < 2) return 0; // Need at least some history
    
    // The history array already has the current volume at the end from checkVolumeAnomaly
    // So we calculate average of all BUT the last element
    const previous = history.slice(0, -1);
    const avgVol = previous.reduce((a, b) => a + b, 0) / previous.length;
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

  // Get top N tokens by absolute funding rate across all perpetual exchanges
  async getTopFunding(topN = config.TOP_NUMBER) {
    const results = [];

    for (const key of config.EXCHANGES) {
      const ex = this.exchanges[key];
      if (!ex) continue;
      
      const marketType = this.getMarketType(key);
      if (marketType !== 'Perpetual') continue;

      try {
        const symbols = await ex.api.getSymbols();
        const tickers = await ex.api.getTickers();

        for (const symbol of symbols.slice(0, 100)) {
          const ticker = tickers[symbol];
          if (!ticker || ticker.volume24h < config.MIN_VOLUME_USDT) continue;

          try {
            let fundingVal = ticker.fundingRate;
            let fundingObj = { rate: ticker.fundingRate, nextFundingTime: ticker.nextFundingTime, intervalHours: ticker.intervalHours };
            if (fundingVal === undefined) {
              if (typeof ex.api.getTickerInfo === 'function') {
                const info = await ex.api.getTickerInfo(symbol);
                if (typeof info === 'object' && info !== null) {
                  fundingObj = info;
                  fundingVal = info.rate;
                } else {
                  fundingObj = { rate: info };
                  fundingVal = info;
                }
              } else {
                continue;
              }
            }
            
            if (fundingVal !== undefined && fundingVal !== null) {
                results.push({
                    symbol,
                    exchange: ex.name,
                    fundingRate: fundingVal,
                    fundingObj: fundingObj,
                    price: ticker.lastPrice
                });
            }
          } catch (e) {
            // Skip individual symbol errors
          }

          await delay(100);
        }
      } catch (err) {
        console.error(`❌ Error fetching funding data from ${ex.name}:`, err.message);
      }
    }

    // Sort by absolute funding rate descending (biggest movers)
    return results.sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate)).slice(0, topN);
  }

  // Send top funding response to Telegram
  async sendTopFunding(chatId) {
    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(chatId, '🔍 Scanning for top funding rates...');
    }

    try {
      const top = await this.getTopFunding();

      if (top.length === 0) {
        if (this.tgBot) {
          await this.tgBot.telegram.sendMessage(chatId, '⚠️ No funding data found.');
        }
        return;
      }

      const lines = top.map((t, i) =>
        `${i + 1}. *${escapeMd(t.symbol)}* (${escapeMd(t.exchange)})\n   Funding: ${formatFundingObj(t.fundingObj)} | Price: $${t.price}`
      );

      const message = `🏦 *Top ${config.TOP_NUMBER} Funding Rates*\n\n` + lines.join('\n\n');

      if (this.tgBot) {
        await this.tgBot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error('❌ Error in /funding command:', err.message);
      if (this.tgBot) {
        await this.tgBot.telegram.sendMessage(chatId, '❌ Error fetching funding data.');
      }
    }
  }

  // Determine market type from exchange key
  getMarketType(exchangeKey) {
    return !exchangeKey.endsWith('_spot') ? 'Perpetual' : 'Spot';
  }

  async sendVolumeAlert(chatId, exchange, symbol, volRatio, marketType, fundingObj) {
    let message = `📊 *VOLUME ALERT [${config.ALERT_VOLUME_TF}m]*\n\n` +
      `Market: ${escapeMd(exchange.replace('_spot', '').toUpperCase())} [${marketType}]\n` +
      `Symbol: ${escapeMd(symbol)}\n` +
      `Volume: ${volRatio.toFixed(2)}x average`;
    if (marketType === 'Perpetual' && fundingObj && fundingObj.rate !== null && fundingObj.rate !== undefined) {
      message += `\nFunding: ${formatFundingObj(fundingObj)}`;
    }

    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
      });
    }
    console.log(`📊 VOLUME ALERT: ${symbol} on ${exchange} [${marketType}] (${volRatio.toFixed(2)}x)`);
  }

  async sendATRAlert(chatId, exchange, symbol, atrData, marketType, fundingObj) {
    let message = `📈 *ATR ALERT [${config.ALERT_ATR_TF}m]*\n\n` +
      `Market: ${escapeMd(exchange.replace('_spot', '').toUpperCase())} [${marketType}]\n` +
      `Symbol: ${escapeMd(symbol)}\n` +
      `ATR: ${atrData.map(a => `${a.atr.toFixed(2)}%`).join(', ')}`;
    if (marketType === 'Perpetual' && fundingObj && fundingObj.rate !== null && fundingObj.rate !== undefined) {
      message += `\nFunding: ${formatFundingObj(fundingObj)}`;
    }

    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
      });
    }
    console.log(`📈 ATR ALERT: ${symbol} on ${exchange} [${marketType}]`);
  }

  async sendPriceAlert(chatId, exchange, symbol, priceChange, price, marketType, fundingObj) {
    const arrow = priceChange >= 0 ? '🟢' : '🔴';
    const sign = priceChange >= 0 ? '+' : '';
    let message = `💰 *PRICE ALERT [${config.ALERT_PRICE_TF}m]* ${arrow}\n\n` +
      `Market: ${escapeMd(exchange.replace('_spot', '').toUpperCase())} [${marketType}]\n` +
      `Symbol: ${escapeMd(symbol)}\n` +
      `Price: $${price}\n` +
      `Change: ${sign}${priceChange.toFixed(2)}%`;
    if (marketType === 'Perpetual' && fundingObj && fundingObj.rate !== null && fundingObj.rate !== undefined) {
      message += `\nFunding: ${formatFundingObj(fundingObj)}`;
    }

    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
      });
    }
    console.log(`💰 PRICE ALERT: ${symbol} on ${exchange} [${marketType}] (${sign}${priceChange.toFixed(2)}%)`);
  }

  async sendFundingRateAlert(chatId, exchange, symbol, targetFundingObj, otherRates) {
    let message = `🏦 *FUNDING RATE ALERT*\n\n` +
      `Symbol: ${escapeMd(symbol)}\n` +
      `*${escapeMd(exchange.replace('_spot', '').toUpperCase())} [Perpetual]*: ${formatFundingObj(targetFundingObj)}`;

    if (otherRates && otherRates.length > 0) {
      message += `\n\nOther Exchanges:\n` + otherRates.map(r => 
        ` - ${escapeMd(r.exchange.replace(' Spot', '').toUpperCase())} [Perpetual]: ${formatFundingObj(r.obj)}`
      ).join('\n');
    }

    if (this.tgBot) {
      await this.tgBot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
      });
    }
    console.log(`🏦 FUNDING ALERT: ${symbol} on ${exchange} (${formatFundingObj(targetFundingObj)})`);
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
        let volRatio = 0;
        let priceChange = null;
        let currentPrice = null;
        const marketType = this.getMarketType(exchangeKey);

        try {
          // Volume check: 1m candles over ALERT_VOLUME_TF minutes
          const volCandles = await api.getKlines(symbol, '1m', config.ALERT_VOLUME_TF);
          if (volCandles.length >= 20) {
            const lastCandle = volCandles[volCandles.length - 1];
            const ratio = this.checkVolumeAnomaly(symbol, lastCandle.volume);
            if (ratio !== false) {
              volRatio = ratio;
            }
          }
        } catch (e) { /* skip */ }

        try {
          // ATR check: use ALERT_ATR_TF as the candle interval
          const atrTf = config.ALERT_ATR_TF + 'm';
          const atrCandles = await api.getKlines(symbol, atrTf);
          if (atrCandles.length >= 15) {
            const atr = this.calculateATR(atrCandles);
            if (atr !== null) {
              atrData.push({ tf: atrTf, atr });
            }
          }
        } catch (e) { /* skip */ }

        try {
          // Price check: 1m candles over ALERT_PRICE_TF minutes
          const priceCandles = await api.getKlines(symbol, '1m', config.ALERT_PRICE_TF);
          if (priceCandles.length >= 2) {
            const openPrice = priceCandles[0].open;
            const closePrice = priceCandles[priceCandles.length - 1].close;
            if (openPrice > 0) {
              priceChange = ((closePrice - openPrice) / openPrice) * 100;
              currentPrice = closePrice;
            }
          }
        } catch (e) { /* skip */ }

        let fundingRateVal = null;
        let fundingObj = { rate: null };
        if (marketType === 'Perpetual' && ticker.fundingRate !== undefined) {
           fundingRateVal = ticker.fundingRate;
           fundingObj = { rate: ticker.fundingRate, nextFundingTime: ticker.nextFundingTime, intervalHours: ticker.intervalHours };
        }

        const activeUsers = DB.getActiveUsers();

        for (const user of activeUsers) {
          if (!user.enabledExchanges.includes(exchangeKey)) continue;

          // Helper to get explicit funding object
          const getExplicitObj = async () => {
            if (typeof api.getTickerInfo === 'function') {
              const info = await api.getTickerInfo(symbol);
              if (typeof info === 'object' && info !== null) return info;
              return { rate: info };
            }
            return fundingObj;
          };

          // 1. Funding Rate Alert
          if (fundingRateVal !== null && Math.abs(fundingRateVal * 100) >= user.fundingThreshold) {
            const fundKey = `${user.chatId}:fund:${exchangeKey}:${symbol}`;
            if (!this.alertedSymbols.has(fundKey)) {
              const explicitCallObj = await getExplicitObj();
              const explicitRate = explicitCallObj.rate;
              if (explicitRate !== null && Math.abs(explicitRate * 100) >= user.fundingThreshold) {
                const otherFundingRates = [];
                for (const otherKey of config.EXCHANGES) {
                  if (otherKey === exchangeKey) continue;
                  const otherEx = this.exchanges[otherKey];
                  if (otherEx && this.getMarketType(otherKey) === 'Perpetual' && typeof otherEx.api.getTickerInfo === 'function') {
                    try {
                      const otherFr = await otherEx.api.getTickerInfo(symbol);
                      if (otherFr !== null) {
                        const otherObj = typeof otherFr === 'object' ? otherFr : { rate: otherFr };
                        otherFundingRates.push({ exchange: otherEx.name, obj: otherObj });
                      }
                    } catch (e) { /* skip */ }
                  }
                }
                await this.sendFundingRateAlert(user.chatId, exchangeKey, symbol, explicitCallObj, otherFundingRates);
                this.alertedSymbols.add(fundKey);
                setTimeout(() => this.alertedSymbols.delete(fundKey), 1800000); // 30 min cooldown
              }
            }
          }

          // 2. Volume Alert
          if (volRatio >= user.volumeThreshold) {
            const volKey = `${user.chatId}:vol:${exchangeKey}:${symbol}`;
            if (!this.alertedSymbols.has(volKey)) {
              const explicitCallObj = await getExplicitObj();
              await this.sendVolumeAlert(user.chatId, exchangeKey, symbol, volRatio, marketType, explicitCallObj);
              this.alertedSymbols.add(volKey);
              setTimeout(() => this.alertedSymbols.delete(volKey), 1800000);
            }
          }

          // 3. ATR Alert
          if (atrData.length > 0 && atrData.some(a => a.atr >= user.atrThreshold)) {
            const filteredAtrData = atrData.filter(a => a.atr >= user.atrThreshold);
            if (filteredAtrData.length > 0) {
              const atrKey = `${user.chatId}:atr:${exchangeKey}:${symbol}`;
              if (!this.alertedSymbols.has(atrKey)) {
                const explicitCallObj = await getExplicitObj();
                await this.sendATRAlert(user.chatId, exchangeKey, symbol, filteredAtrData, marketType, explicitCallObj);
                this.alertedSymbols.add(atrKey);
                setTimeout(() => this.alertedSymbols.delete(atrKey), 1800000);
              }
            }
          }

          // 4. Price Alert
          if (priceChange !== null && Math.abs(priceChange) >= user.priceThreshold) {
            const priceKey = `${user.chatId}:price:${exchangeKey}:${symbol}`;
            if (!this.alertedSymbols.has(priceKey)) {
              const explicitCallObj = await getExplicitObj();
              await this.sendPriceAlert(user.chatId, exchangeKey, symbol, priceChange, currentPrice, marketType, explicitCallObj);
              this.alertedSymbols.add(priceKey);
              setTimeout(() => this.alertedSymbols.delete(priceKey), 1800000);
            }
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
    console.log('🚀 Red Rocket Eye started...');
    console.log(`Volume: ${config.ALERT_VOLUME_THRESHOLD}x | ATR: ${config.ALERT_ATR_THRESHOLD}% | Price: ${config.ALERT_PRICE_THRESHOLD}% | Funding: ${config.ALERT_FUNDING_THRESHOLD}% | Interval: ${config.CHECK_INTERVAL / 1000}s`);

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
  // Send startup message to all active users
  const activeUsers = DB.getActiveUsers();
  for (const user of activeUsers) {
    tracker.tgBot.telegram.sendMessage(
      user.chatId,
      '🚀 *Red Rocket Eye Reststarted*\n\n' +
      `*Your Global Scanning Pool:* ${escapeMd([...new Set(config.EXCHANGES.map(e => e.replace('_spot', '')))].join(', ').toUpperCase())}\n` +
      `*Interval:* ${config.CHECK_INTERVAL / 1000}s\n\n` + 
      `Type /settings to configure your personal alert thresholds and active exchanges.`,
      { parse_mode: 'Markdown' }
    ).catch(e => { /* user blocked bot */ });
  }

  // Keyboard Generator
  const getSettingsKeyboard = (user) => {
     return [
       [{ text: `📊 Vol Threshold: ${user.volumeThreshold}x`, callback_data: 'edit_vol' }],
       [{ text: `📈 ATR Threshold: ${user.atrThreshold}%`, callback_data: 'edit_atr' }],
       [{ text: `💰 Price Threshold: ${user.priceThreshold}%`, callback_data: 'edit_price' }],
       [{ text: `🏦 Funding Threshold: ${user.fundingThreshold}%`, callback_data: 'edit_fund' }],
       [{ text: `🔄 Toggle Exchanges >>`, callback_data: 'menu_exchanges' }],
       [{ text: `⚠️ Reset to Default`, callback_data: 'reset_defaults' }]
     ];
  };

  const getExchangesKeyboard = (user) => {
     const uniqueExchanges = [...new Set(config.EXCHANGES.map(e => e.replace('_spot', '')))];
     const btns = uniqueExchanges.map(exName => {
        // Find all underlying config.EXCHANGES that match this base name
        const subExchanges = config.EXCHANGES.filter(e => e === exName || e === `${exName}_spot`);
        const isEnabled = subExchanges.some(e => user.enabledExchanges.includes(e));
        return [{
            text: `${isEnabled ? '✅' : '❌'} ${exName.toUpperCase()}`,
            callback_data: `toggle_base_ex:${exName}`
        }];
     });
     btns.push([{ text: `🔙 Back to Settings`, callback_data: 'menu_main' }]);
     return btns;
  };

  // Commands
  tracker.tgBot.command('start', (ctx) => {
    DB.addUser(ctx.chat.id);
    ctx.reply('👋 Welcome to Red Rocket Eye!\nYou are now registered and will receive alerts based on default thresholds.\n\nType /settings to configure your personal alerts.');
  });

  tracker.tgBot.command('settings', (ctx) => {
    const user = DB.getUser(ctx.chat.id) || DB.addUser(ctx.chat.id);
    ctx.reply('⚙️ *Your Alert Settings*\nClick a button below to configure:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: getSettingsKeyboard(user) }
    });
  });

  tracker.tgBot.command('users', (ctx) => {
    if (!config.ADMIN_UIDS.includes(ctx.chat.id.toString())) {
      return ctx.reply('❌ Permission denied. You must be an administrator to use this command.');
    }

    try {
      const stats = DB.getStats();
      ctx.reply(
        `👥 *User Statistics*\n\n` +
        `*Total Registered:* ${stats.totalUsers}\n` +
        `*Active Alerts:* ${stats.activeUsers}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('❌ Error in /users command:', err.message);
      ctx.reply('❌ Error fetching user statistics.');
    }
  });

  // Action Handlers
  tracker.tgBot.action('menu_main', (ctx) => {
    const user = DB.getUser(ctx.chat.id);
    ctx.editMessageText('⚙️ *Your Alert Settings*\nClick a button below to configure:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: getSettingsKeyboard(user) }
    });
  });

  tracker.tgBot.action('menu_exchanges', (ctx) => {
    const user = DB.getUser(ctx.chat.id);
    ctx.editMessageText('🔄 *Toggle Exchanges*\nEnable or disable monitoring directly:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: getExchangesKeyboard(user) }
    });
  });

  tracker.tgBot.action(/^toggle_base_ex:(.+)$/, (ctx) => {
    const exBaseName = ctx.match[1];
    const subExchanges = config.EXCHANGES.filter(e => e === exBaseName || e === `${exBaseName}_spot`);
    
    // Toggle them all together for simplicity in UI, or at least flip state based on first
    for (const exactKey of subExchanges) {
       DB.toggleExchange(ctx.chat.id, exactKey);
    }
    const user = DB.getUser(ctx.chat.id);
    ctx.editMessageReplyMarkup({ inline_keyboard: getExchangesKeyboard(user) });
  });

  tracker.tgBot.action('reset_defaults', (ctx) => {
    const user = DB.resetUser(ctx.chat.id);
    ctx.answerCbQuery('✅ Settings restored to default!');
    ctx.editMessageText('⚙️ *Your Alert Settings*\nClick a button below to configure:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: getSettingsKeyboard(user) }
    });
  });

  // Simple state for waiting for user input
  const pendingInput = new Map();

  ['vol', 'atr', 'price', 'fund'].forEach(type => {
    tracker.tgBot.action(`edit_${type}`, (ctx) => {
      pendingInput.set(ctx.chat.id, type);
      ctx.reply(`Please send the new value for your ${type.toUpperCase()} threshold as a number:\n(e.g., 2.5)`);
      ctx.answerCbQuery();
    });
  });

  // Listen for text to catch new threshold values
  tracker.tgBot.on('text', (ctx, next) => {
    const type = pendingInput.get(ctx.chat.id);
    if (!type || ctx.message.text.startsWith('/')) return next();

    const val = parseFloat(ctx.message.text.replace(',', '.'));
    if (isNaN(val)) {
      return ctx.reply('❌ Invalid number. Please send a valid number.');
    }

    const fieldMap = {
      'vol': 'volumeThreshold',
      'atr': 'atrThreshold',
      'price': 'priceThreshold',
      'fund': 'fundingThreshold'
    };

    DB.updateThreshold(ctx.chat.id, fieldMap[type], val);
    pendingInput.delete(ctx.chat.id);

    const user = DB.getUser(ctx.chat.id);
    ctx.reply('✅ Threshold updated successfully!', {
      reply_markup: { inline_keyboard: getSettingsKeyboard(user) }
    });
  });

  // Register bot command menu (shows in the "/" button in Telegram)
  tracker.tgBot.telegram.setMyCommands([
    { command: 'start', description: 'Register with the bot' },
    { command: 'settings', description: 'Configure personal thresholds and exchanges' },
    { command: 'status', description: 'Check if the bot is online' },
    { command: 'atr', description: 'Top tokens by ATR on 5m timeframe' },
    { command: 'volume', description: 'Top tokens by volume change (last 1h)' },
    { command: 'price', description: 'Top tokens by price change (last 6h)' },
    { command: 'funding', description: 'Top perpetual tokens by absolute funding rate' },
    { command: 'users', description: 'Show user statistics (admin only)' },
  ]).catch(err => console.error('❌ Failed to set bot commands:', err.message));

  // Catch Telegraf runtime errors (like polling timeouts)
  tracker.tgBot.catch((err) => {
    console.error('❌ Telegram Bot Error:', err.message || err);
  });

  tracker.tgBot.launch().catch(err => {
    console.error('❌ Telegram Launch Error:', err.message || err);
  });

  // Prevent global unhandled promise rejections from crashing the scanner
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection at:', promise, 'reason:', reason);
  });

  // Graceful shutdown — stop polling to prevent 409 Conflict on restart
  process.once('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    tracker.tgBot.stop('SIGINT');
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    console.log('\n🛑 Shutting down...');
    tracker.tgBot.stop('SIGTERM');
    process.exit(0);
  });
}
