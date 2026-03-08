const axios = require('axios');

class BybitAPI {
  constructor() {
    this.baseURL = 'https://api.bybit.com/v5';
  }

  // Get all USDT perpetual symbols
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/market/instruments-info`, {
      params: { category: 'linear', limit: 1000 }
    });
    return res.data.result.list
      .filter(s => s.quoteCoin === 'USDT' && s.status === 'Trading')
      .map(s => s.symbol);
  }

  // Get klines (candles) for a symbol
  async getKlines(symbol, interval, limit = 200) {
    const res = await axios.get(`${this.baseURL}/market/kline`, {
      params: { category: 'linear', symbol, interval, limit }
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

  // Get 24h ticker for volume
  async getTickers() {
    const res = await axios.get(`${this.baseURL}/market/tickers`, {
      params: { category: 'linear' }
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

module.exports = BybitAPI;
