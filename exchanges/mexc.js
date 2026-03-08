const axios = require('axios');

class MEXCAPI {
    constructor() {
        this.baseURL = 'https://contract.mexc.com/api/v1/contract';
    }

    // Map standard intervals to MEXC contract format
    static INTERVAL_MAP = {
        '1m': 'Min1', '3m': 'Min3', '5m': 'Min5', '15m': 'Min15', '30m': 'Min30',
        '1h': 'Hour1', '2h': 'Hour2', '4h': 'Hour4', '8h': 'Hour8',
        '1d': 'Day1', '1w': 'Week1', '1M': 'Month1'
    };

    // Get all USDT perpetual symbols
    async getSymbols() {
        const res = await axios.get(`${this.baseURL}/detail`);
        return res.data.data
            .filter(s => s.quoteCoin === 'USDT' && s.state === 0 && !s.isHidden)
            .map(s => s.symbol);
    }

    // Get klines (candles) for a symbol
    async getKlines(symbol, interval, limit = 200) {
        const mexcInterval = MEXCAPI.INTERVAL_MAP[interval] || interval;
        const res = await axios.get(`${this.baseURL}/kline/${symbol}`, {
            params: { interval: mexcInterval }
        });

        const d = res.data.data;
        if (!d || !d.time || d.time.length === 0) return [];

        const candles = [];
        const count = Math.min(d.time.length, limit);
        for (let i = 0; i < count; i++) {
            candles.push({
                time: d.time[i] * 1000, // Convert seconds to milliseconds
                open: parseFloat(d.open[i]),
                high: parseFloat(d.high[i]),
                low: parseFloat(d.low[i]),
                close: parseFloat(d.close[i]),
                volume: parseFloat(d.vol[i])
            });
        }
        return candles;
    }

    // Get 24h ticker for volume
    async getTickers() {
        const res = await axios.get(`${this.baseURL}/ticker`);
        return res.data.data.reduce((acc, t) => {
            if (t.symbol.endsWith('_USDT')) {
                acc[t.symbol] = {
                    volume24h: parseFloat(t.amount24),
                    lastPrice: parseFloat(t.lastPrice),
                    fundingRate: parseFloat(t.fundingRate) || 0
                };
            }
            return acc;
        }, {});
    }

    // Fetch funding rate for a specific symbol
    async getTickerInfo(symbol) {
        try {
            const res = await axios.get(`${this.baseURL}/ticker`, {
                params: { symbol }
            });
            if (res.data && res.data.success && res.data.data) {
                return parseFloat(res.data.data.fundingRate) || 0;
            }
        } catch (err) {
            // Return null if symbol doesn't exist or API fails
        }
        return null;
    }
}

module.exports = MEXCAPI;
