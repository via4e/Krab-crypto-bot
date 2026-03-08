# Krab Crypto Bot - System Architecture & Developer Guide

## 1. Project Overview
This document serves as a comprehensive developer prompt and architectural blueprint for rebuilding "Krab Crypto Bot".
The system is a cryptocurrency market scanner and Telegram alerting bot. It monitors multiple exchanges for high-volume spikes combined with elevated volatility (Average True Range - ATR).

## 2. Core Features
- **Multi-Exchange Polling:** Scans USDT pairs across multiple exchanges (e.g., Bybit Perpetual, MEXC Spot, MEXC Perpetual).
- **Technical Analysis:** Calculates Average True Range (ATR) over N periods to measure volatility.
- **Volume Anomaly Detection:** Compares current 1-minute candle volume against an N-period moving average to detect spikes.
- **Alerting System:** Sends formatted Markdown messages to a specific Telegram chat when specific thresholds are met.
- **On-Demand Commands:** Responds to user Telegram commands (`/status`, `/atr`, `/volume`, `/price`) with real-time market snapshots.
- **State Management:** Maintains short-term memory of volume history and recently alerted symbols (to prevent spam).

## 3. System Architecture

The system follows a modular, object-oriented design (or equivalent in functional languages) built around asynchronous data polling.

### 3.1. Main Modules
1. **Application Entry Point (e.g., Main Loop / Tracker)**
2. **Configuration Module**
3. **Exchange Connection Adapters (Interfaces)**
4. **Technical Analysis (TA) Engine**
5. **Telegram/Messaging Client**
6. **State Manager (Memory Cache)**

### 3.2. Data Flow (Polling Cycle)
1. **Initialize:** Load config, connect to Telegram, instantiate Exchange Adapters.
2. **Scan Interval Trigger (e.g., 60s):**
   - For each configured Exchange:
     - Fetch all available USDT symbols.
     - Fetch 24-hour tickers (to filter out low-volume "dust" pairs).
     - For each valid symbol (rate-limited):
       - Fetch recent Klines (candles) for configured timeframes (e.g., 1m, 5m, 15m).
       - *Condition 1:* Calculate ATR. Does it exceed `ATR_THRESHOLD`?
       - *Condition 2:* Calculate current 1m volume against historical average. Does it exceed `VOLUME_MULTIPLIER`?
       - If both conditions are true & symbol not in cooldown:
         - Dispatch Alert to Telegram.
         - Add symbol to cooldown cache.

---

## 4. Module Specifications

### 4.1. Configuration Module
A singleton or static file storing application parameters.
**Required Fields:**
- `VOLUME_MULTIPLIER` (Float): e.g., 3.0 (3x average volume).
- `ATR_THRESHOLD` (Float): e.g., 1.5 (Minimum ATR percentage).
- `CHECK_INTERVAL` (Integer): e.g., 60000ms (Polling frequency).
- `TIMEFRAMES` (Array of Strings): e.g., ["1m", "5m", "15m"].
- `EXCHANGES` (Array of Strings): Identifiers for active exchanges.
- `MIN_VOLUME_USDT` (Integer): e.g., 10000 (Filters out pairs with < 10k 24h volume).
- `TOP_NUMBER` (Integer): e.g., 5 (Number of results for Telegram commands).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: Credentials.

### 4.2. Exchange Adapters
An Interface/Abstract Base Class defining standard market operations.
**Required Methods:**
- `getSymbols()`: Returns a list of strings (e.g., `["BTCUSDT", "ETHUSDT"]`). Must filter for active, USDT-quoted pairs.
- `getTickers()`: Returns a dictionary/map of symbols to `volume24h` and `lastPrice`.
- `getKlines(symbol, interval, limit)`: Returns an array of Candle objects sorted oldest to newest. 
  - *Candle Object structure:* `{ time: int, open: float, high: float, low: float, close: float, volume: float }`

### 4.3. Technical Analysis Engine
**Method 1: Calculate ATR (Percentage)**
1. Requires an array of Candles and a `period` (default 14).
2. For each candle (starting at index 1), calculate True Range (TR):
   - `TR = max(high - low, abs(high - prev_close), abs(low - prev_close))`
3. Average the last 14 TR values.
4. Convert to a percentage of the current price: `(ATR / current_close) * 100`.

**Method 2: Volume Anomaly Detection**
1. Maintains a rolling array of the last N (e.g., 20) 1m candle volumes for a specific symbol.
2. Calculates the simple moving average (SMA) of these volumes.
3. Compares the *latest* volume to the SMA: `Ratio = currentVolume / avgVolume`.
4. Returns `True` if `Ratio >= VOLUME_MULTIPLIER`.

### 4.4. State Management (Cooldowns & History)
- **Volume History Cache:** A map/dictionary mapping `symbol` -> `Array[Volumes]`. Array should be capped (e.g., shift out oldest after 100 items).
- **Alert Cooldown Cache:** A thread-safe Set or Dictionary storing `exchange:symbol`. Entries must automatically expire/delete after 30 minutes to prevent duplicate alerts.

### 4.5. Telegram Interaction Handler
**Outgoing Alerts:**
- Formats text (e.g., Markdown) escaping special characters (`_`, `*`, `[`).
- Sends async HTTP POST to Telegram Bot API `sendMessage` endpoint.

**Incoming Commands:**
- `/status`: Replies with bot health/uptime.
- `/atr`: Fetches top N pairs with highest 5m ATR across all exchanges.
- `/volume`: Fetches 1h klines. Compares sum of volume in first 30m vs last 30m. Returns top N pairs by volume change percentage.
- `/price`: Fetches 1h klines for last 6h. Calculates `((close - open) / open) * 100`. Returns top N pairs by absolute price change.

---

## 5. Development Considerations
- **Concurrency & Rate Limiting:** The app makes hundreds of HTTP requests per cycle. Implement a rate-limiter or a small delay (e.g., 100ms) between requests to avoid HTTP 429 (Too Many Requests) bans from exchanges.
- **Error Handling:** Network timeouts or API parsing errors for a single symbol MUST NOT crash the main loop. Catch and ignore individual symbol errors.
- **Graceful Shutdown:** Intercept OS signals (SIGINT, SIGTERM) to close network connections safely.
