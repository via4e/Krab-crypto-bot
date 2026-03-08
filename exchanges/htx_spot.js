const axios = require('axios');

class HTXSpotAPI {
  constructor() {
    this.baseURL = 'https://api.huobi.pro';
  }

  // Get all USDT spot symbols
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/v1/common/symbols`);
    return res.data.data
      .filter(s => s['quote-currency'] === 'usdt' && s.state === 'online')
      .map(s => s.symbol);
  }

  static INTERVAL_MAP = {
    '1m': '1min', '3m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '60min', '2h': '60min', '4h': '4hour', '8h': '4hour',
    '1d': '1day', '1w': '1week', '1M': '1mon'
  };

  // Get klines (candles) for a symbol
  async getKlines(symbol, interval, limit = 200) {
    const htxInterval = HTXSpotAPI.INTERVAL_MAP[interval] || '1min';
    const res = await axios.get(`${this.baseURL}/market/history/kline`, {
      params: { symbol, period: htxInterval, size: limit }
    });
    
    if (!res.data.data || !Array.isArray(res.data.data)) return [];

    return res.data.data.map(k => ({
      time: k.id * 1000,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.vol) // quote volume in HTX spot
    })).reverse(); // Oldest first
  }

  // Get 24h ticker for volume
  async getTickers() {
    const res = await axios.get(`${this.baseURL}/market/tickers`);
    if (!res.data.data) return {};
    
    return res.data.data.reduce((acc, t) => {
      if (t.symbol.endsWith('usdt')) {
        acc[t.symbol] = {
          volume24h: parseFloat(t.vol),
          lastPrice: parseFloat(t.close)
        };
      }
      return acc;
    }, {});
  }
}

module.exports = HTXSpotAPI;
