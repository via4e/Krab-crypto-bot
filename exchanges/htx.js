const axios = require('axios');

class HTXAPI {
  constructor() {
    this.baseURL = 'https://api.hbdm.com';
  }

  // Get all USDT perpetual symbols (linear swap)
  async getSymbols() {
    const res = await axios.get(`${this.baseURL}/linear-swap-api/v1/swap_contract_info`);
    return res.data.data
      .filter(s => s.contract_code.endsWith('-USDT') && s.contract_status === 1)
      .map(s => s.contract_code);
  }

  static INTERVAL_MAP = {
    '1m': '1min', '3m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '60min', '2h': '60min', '4h': '4hour', '8h': '4hour',
    '1d': '1day', '1w': '1week', '1M': '1mon'
  };

  async getKlines(symbol, interval, limit = 200) {
    const htxInterval = HTXAPI.INTERVAL_MAP[interval] || '1min';
    const res = await axios.get(`${this.baseURL}/linear-swap-ex/market/history/kline`, {
      params: { contract_code: symbol, period: htxInterval, size: limit }
    });
    if (!res.data.data || !Array.isArray(res.data.data)) return [];

    return res.data.data.map(k => ({
      time: k.id * 1000,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.trade_turnover) // quote volume
    })).reverse();
  }

  async getTickers() {
    const res = await axios.get(`${this.baseURL}/linear-swap-ex/market/detail/batch_merged`);
    if (!res.data.ticks) return {};
    
    return res.data.ticks.reduce((acc, t) => {
      if (t.contract_code.endsWith('-USDT')) {
        acc[t.contract_code] = {
          volume24h: parseFloat(t.trade_turnover),
          lastPrice: parseFloat(t.close)
        };
      }
      return acc;
    }, {});
  }

  // Fetch funding rate for a specific symbol
  async getTickerInfo(symbol) {
    try {
      const res = await axios.get(`${this.baseURL}/linear-swap-api/v1/swap_funding_rate`, {
        params: { contract_code: symbol }
      });
      // HTX returns a single object or an array depending on the query, let's gracefully handle both
      let data = res.data.data;
      if (Array.isArray(data) && data.length > 0) {
        data = data[0];
      }
      if (data && data.funding_rate !== undefined) {
        return {
          rate: parseFloat(data.funding_rate) || 0,
          nextFundingTime: parseInt(data.next_funding_time) || parseInt(data.funding_time) || null,
          intervalHours: null
        };
      }
    } catch (err) {
      // Return null if symbol doesn't exist or API fails
    }
    return null;
  }
}

module.exports = HTXAPI;
