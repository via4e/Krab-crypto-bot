const axios = require('axios');

class GateAPI {
  constructor() {
    this.baseURL = 'https://api.gateio.ws/api/v4/futures/usdt';
  }

  // Get all USDT perpetual contracts
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/contracts`);
    return res.data
      .filter(s => s.name.endsWith('_USDT') && s.status === 'trading' && !s.in_delisting)
      .map(s => s.name);
  }

  // Get klines (candles) for a contract
  // Gate.io futures candles: { t, o, h, l, c, v, sum }
  async getKlines(symbol, interval, limit = 200) {
    const res = await axios.get(`${this.baseURL}/candlesticks`, {
      params: { contract: symbol, interval, limit }
    });
    return res.data.map(k => ({
      time: k.t * 1000,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.sum) // quote volume (USDT)
    }));
  }

  // Get 24h ticker for volume
  async getTickers() {
    const res = await axios.get(`${this.baseURL}/tickers`);
    return res.data.reduce((acc, t) => {
      if (t.contract && t.contract.endsWith('_USDT')) {
        acc[t.contract] = {
          volume24h: parseFloat(t.volume_24h_quote),
          lastPrice: parseFloat(t.last),
          fundingRate: parseFloat(t.funding_rate) || 0
        };
      }
      return acc;
    }, {});
  }

  // Fetch funding rate for a specific symbol
  async getTickerInfo(symbol) {
    try {
      const res = await axios.get(`${this.baseURL}/tickers`, {
        params: { contract: symbol }
      });
      if (res.data && res.data.length > 0) {
        return parseFloat(res.data[0].funding_rate) || 0;
      }
    } catch (err) {
      // Return null if symbol doesn't exist or API fails
    }
    return null;
  }
}

module.exports = GateAPI;
