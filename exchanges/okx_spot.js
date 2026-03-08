const axios = require('axios');

class OKXSpotAPI {
  constructor() {
    this.baseURL = 'https://www.okx.com/api/v5';
  }

  // Get all USDT spot symbols
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/public/instruments`, {
      params: { instType: 'SPOT' }
    });
    return res.data.data
      .filter(s => s.quoteCcy === 'USDT' && s.state === 'live')
      .map(s => s.instId);
  }

  // Map standard intervals to OKX format
  static INTERVAL_MAP = {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1H', '2h': '2H', '4h': '4H', '1d': '1D', '1w': '1W'
  };

  // Get klines (candles) for a symbol
  async getKlines(symbol, interval, limit = 200) {
    const okxInterval = OKXSpotAPI.INTERVAL_MAP[interval] || interval;
    const res = await axios.get(`${this.baseURL}/market/candles`, {
      params: { instId: symbol, bar: okxInterval, limit }
    });
    return res.data.data.map(k => ({
      time: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[7]) || parseFloat(k[6]) // quote volume
    })).reverse(); // Oldest first
  }

  // Get 24h ticker for volume
  async getTickers() {
    const res = await axios.get(`${this.baseURL}/market/tickers`, {
      params: { instType: 'SPOT' }
    });
    return res.data.data.reduce((acc, t) => {
      if (t.instId.endsWith('-USDT')) {
        acc[t.instId] = {
          volume24h: parseFloat(t.volCcy24h) * parseFloat(t.last), // base vol * price usually safer for OKX
          lastPrice: parseFloat(t.last)
        };
      }
      return acc;
    }, {});
  }
}

module.exports = OKXSpotAPI;
