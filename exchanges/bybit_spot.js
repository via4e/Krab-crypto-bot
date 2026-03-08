const axios = require('axios');

class BybitSpotAPI {
  constructor() {
    this.baseURL = 'https://api.bybit.com/v5';
  }

  // Get all USDT perpetual (linear) symbols
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/market/instruments-info`, {
      params: { category: 'spot', limit: 1000 }
    });
    return res.data.result.list
      .filter(s => s.quoteCoin === 'USDT' && s.status === 'Trading')
      .map(s => s.symbol);
  }

  // Map standard intervals to Bybit format
  static INTERVAL_MAP = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
    '1h': '60', '2h': '120', '4h': '240', '1d': 'D', '1w': 'W'
  };

  // Get klines (candles) for a symbol
  async getKlines(symbol, interval, limit = 200) {
    const bybitInterval = BybitAPI.INTERVAL_MAP[interval] || interval;
    const res = await axios.get(`${this.baseURL}/market/kline`, {
      params: { category: 'spot', symbol, interval: bybitInterval, limit }
    });
    return res.data.result.list.map(k => ({
      time: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    })).reverse(); // Oldest first
  }

  async getTickers() {
    const res = await axios.get(`${this.baseURL}/market/tickers`, {
      params: { category: 'spot' }
    });
    return res.data.result.list.reduce((acc, t) => {
      if (t.symbol.endsWith('USDT')) {
        acc[t.symbol] = {
          volume24h: parseFloat(t.volume24h) * parseFloat(t.lastPrice),
          lastPrice: parseFloat(t.lastPrice)
        };
      }
      return acc;
    }, {});
  }
}

module.exports = BybitSpotAPI;
