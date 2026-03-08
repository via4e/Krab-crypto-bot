const axios = require('axios');

class GateSpotAPI {
  constructor() {
    this.baseURL = 'https://api.gateio.ws/api/v4/spot';
  }

  // Get all USDT spot symbols
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/currency_pairs`);
    return res.data
      .filter(s => s.quote === 'USDT' && s.trade_status === 'tradable')
      .map(s => s.id);
  }

  // Get klines (candles) for a symbol
  // Gate.io spot candles: [unix_ts, quote_vol, close, highest, lowest, open, base_vol, is_closed]
  async getKlines(symbol, interval, limit = 200) {
    const res = await axios.get(`${this.baseURL}/candlesticks`, {
      params: { currency_pair: symbol, interval, limit }
    });
    return res.data.map(k => ({
      time: parseInt(k[0]) * 1000,
      open: parseFloat(k[5]),
      high: parseFloat(k[3]),
      low: parseFloat(k[4]),
      close: parseFloat(k[2]),
      volume: parseFloat(k[1]) // quote volume (USDT)
    }));
  }

  // Get 24h ticker for volume
  async getTickers() {
    const res = await axios.get(`${this.baseURL}/tickers`);
    return res.data.reduce((acc, t) => {
      if (t.currency_pair && t.currency_pair.endsWith('_USDT')) {
        acc[t.currency_pair] = {
          volume24h: parseFloat(t.quote_volume),
          lastPrice: parseFloat(t.last)
        };
      }
      return acc;
    }, {});
  }
}

module.exports = GateSpotAPI;
