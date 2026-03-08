const axios = require('axios');

class OKXAPI {
  constructor() {
    this.baseURL = 'https://www.okx.com/api/v5';
  }

  // Get all USDT perpetual symbols
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/public/instruments`, {
      params: { instType: 'SWAP' }
    });
    return res.data.data
      .filter(s => s.settleCcy === 'USDT' && s.state === 'live')
      .map(s => s.instId);
  }

  static INTERVAL_MAP = {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1H', '2h': '2H', '4h': '4H', '1d': '1D', '1w': '1W'
  };

  async getKlines(symbol, interval, limit = 200) {
    const okxInterval = OKXAPI.INTERVAL_MAP[interval] || interval;
    const res = await axios.get(`${this.baseURL}/market/candles`, {
      params: { instId: symbol, bar: okxInterval, limit }
    });
    return res.data.data.map(k => ({
      time: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[7]) // quote volume
    })).reverse();
  }

  async getTickers() {
    const res = await axios.get(`${this.baseURL}/market/tickers`, {
      params: { instType: 'SWAP' }
    });
    return res.data.data.reduce((acc, t) => {
      if (t.instId.endsWith('-USDT-SWAP')) {
        acc[t.instId] = {
          volume24h: parseFloat(t.volCcy24h) * parseFloat(t.last),
          lastPrice: parseFloat(t.last)
        };
      }
      return acc;
    }, {});
  }

  // Fetch funding rate for a specific symbol
  async getTickerInfo(symbol) {
    try {
      const res = await axios.get(`${this.baseURL}/public/funding-rate`, {
        params: { instId: symbol }
      });
      if (res.data && res.data.data && res.data.data.length > 0) {
        return parseFloat(res.data.data[0].fundingRate) || 0;
      }
    } catch (err) {
      // Return null if symbol doesn't exist or API fails
    }
    return null;
  }
}

module.exports = OKXAPI;
