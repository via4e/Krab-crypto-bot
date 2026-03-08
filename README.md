# 🦀 Krab Crypto Bot

A Telegram bot that monitors cryptocurrency markets across multiple exchanges and alerts on volume spikes and ATR anomalies.

---

## Tech Stack

- **Node.js** — runtime
- **telegraf** — Telegram bot framework
- **axios** — HTTP requests to exchange APIs
- **Bybit v5 API** / **MEXC v3 API** — market data sources

---

## Features

- 📡 Scans top USDT pairs across Bybit and MEXC every minute
- 🚨 Auto-alerts on volume spikes (configurable multiplier) combined with elevated ATR
- 📊 On-demand top token rankings via Telegram commands
- 🔄 Duplicate alert suppression (30-minute cooldown per symbol)
- ⚡ Rate-limited requests to avoid exchange bans

---

## Commands

| Command | Description |
|---|---|
| `/status` | Check if the bot is online |
| `/atr` | Top 5 tokens by ATR on the 5m timeframe |
| `/volume` | Top 5 tokens by volume change in the last 1 hour |
| `/price` | Top 5 tokens by price change in the last 6 hours |

> The number of top tokens is controlled by `TOP_NUMBER` in `config.js`.

---

## Setup

### 1. Clone & install dependencies

```bash
git clone https://github.com/via4e/Krab-crypto-bot.git
cd Krab-crypto-bot
npm install
```

### 2. Configure the bot

```bash
cp config.example.js config.js
```

Edit `config.js` and fill in your values:

```js
TELEGRAM: {
  enabled: true,
  chatId: 'YOUR_CHAT_ID',    // get from @userinfobot
  botToken: 'YOUR_BOT_TOKEN' // get from @BotFather
}
```

### 3. Start

```bash
npm start
```

The bot will send a startup message to your Telegram chat and begin scanning immediately.

---

## Configuration Reference

| Key | Default | Description |
|---|---|---|
| `VOLUME_MULTIPLIER` | `3` | Volume spike threshold (x times average) |
| `ATR_THRESHOLD` | `1.5` | Minimum ATR % to trigger alert |
| `CHECK_INTERVAL` | `60000` | Scan interval in milliseconds |
| `TIMEFRAMES` | `['1m','5m','15m']` | Timeframes to monitor |
| `EXCHANGES` | `['bybit','mexc']` | Active exchanges |
| `TOP_NUMBER` | `5` | Results count for `/atr`, `/volume`, `/price` |
| `MIN_VOLUME_USDT` | `10000` | Minimum 24h volume filter |
