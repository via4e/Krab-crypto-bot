const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');

const dbPath = path.join(__dirname, 'users.sqlite');
const db = new Database(dbPath);

// Initialize database schema
function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      chatId TEXT PRIMARY KEY,
      volumeThreshold REAL,
      atrThreshold REAL,
      priceThreshold REAL,
      fundingThreshold REAL,
      enabledExchanges TEXT,
      isActive INTEGER DEFAULT 1
    )
  `);
}

initDB();

class DB {
  // Get all active users
  static getActiveUsers() {
    const stmt = db.prepare('SELECT * FROM users WHERE isActive = 1');
    return stmt.all().map(row => ({
      ...row,
      enabledExchanges: JSON.parse(row.enabledExchanges)
    }));
  }

  // Get a specific user by chatId
  static getUser(chatId) {
    const stmt = db.prepare('SELECT * FROM users WHERE chatId = ?');
    const row = stmt.get(chatId.toString());
    if (row) {
      return {
        ...row,
        enabledExchanges: JSON.parse(row.enabledExchanges)
      };
    }
    return null;
  }

  // Add a new user with default config values
  static addUser(chatId) {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO users 
      (chatId, volumeThreshold, atrThreshold, priceThreshold, fundingThreshold, enabledExchanges)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      chatId.toString(),
      config.ALERT_VOLUME_THRESHOLD,
      config.ALERT_ATR_THRESHOLD,
      config.ALERT_PRICE_THRESHOLD,
      config.ALERT_FUNDING_THRESHOLD,
      JSON.stringify(config.EXCHANGES)
    );

    return this.getUser(chatId);
  }

  // Update a user's specific threshold
  // @param field: 'volumeThreshold', 'atrThreshold', 'priceThreshold', or 'fundingThreshold'
  static updateThreshold(chatId, field, value) {
    const allowedFields = ['volumeThreshold', 'atrThreshold', 'priceThreshold', 'fundingThreshold'];
    if (!allowedFields.includes(field)) throw new Error('Invalid threshold field');

    const stmt = db.prepare(`UPDATE users SET ${field} = ? WHERE chatId = ?`);
    stmt.run(value, chatId.toString());
  }

  // Toggle an exchange on or off for a user
  static toggleExchange(chatId, exchangeKey) {
    const user = this.getUser(chatId);
    if (!user) return;

    let exchanges = user.enabledExchanges;
    if (exchanges.includes(exchangeKey)) {
      exchanges = exchanges.filter(e => e !== exchangeKey);
    } else {
      exchanges.push(exchangeKey);
    }

    const stmt = db.prepare('UPDATE users SET enabledExchanges = ? WHERE chatId = ?');
    stmt.run(JSON.stringify(exchanges), chatId.toString());
    
    return exchanges;
  }

  // Turn off alerts for a user
  static deactivateUser(chatId) {
    const stmt = db.prepare('UPDATE users SET isActive = 0 WHERE chatId = ?');
    stmt.run(chatId.toString());
  }

  // Turn on alerts for a user
  static activateUser(chatId) {
    const stmt = db.prepare('UPDATE users SET isActive = 1 WHERE chatId = ?');
    stmt.run(chatId.toString());
  }
}

module.exports = DB;
