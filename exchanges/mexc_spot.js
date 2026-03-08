const axios = require('axios');

class MEXCSpotAPI {
  constructor() {
    this.baseURL = 'https://api.mexc.com/api/v3';
  }

  // Get all USDT spot symbols
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/exchangeInfo`);
    return res.data.symbols
      .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING')
      .map(s => s.symbol);
  }

  // Get klines (candles) for a symbol
  async getKlines(symbol, interval, limit = 200) {
    const res = await axios.get(`${this.baseURL}/klines`, {
      params: { symbol, interval, limit }
    });
    return res.data.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  }

  // Get 24h ticker for volume
  async getTickers() {
    const res = await axios.get(`${this.baseURL}/ticker/24hr`);
    return res.data.reduce((acc, t) => {
      if (t.symbol.endsWith('USDT')) {
        acc[t.symbol] = {
          volume24h: parseFloat(t.quoteVolume),
          lastPrice: parseFloat(t.lastPrice)
        };
      }
      return acc;
    }, {});
  }
}

module.exports = MEXCSpotAPI;
