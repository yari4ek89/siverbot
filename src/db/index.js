import Database from 'better-sqlite3';
import config from '../config.js';

const db = new Database('data.sqlite');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sources(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT UNIQUE NOT NULL,
  username TEXT,
  title TEXT,
  trust_level TEXT DEFAULT 'trusted',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_id INTEGER,
  msg_id TEXT,
  source_ref TEXT,
  date TEXT,
  raw_text TEXT,
  normalized_text TEXT,
  llm_short TEXT,
  category TEXT,
  confidence INTEGER DEFAULT 0,
  safety_flag INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS published(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signature TEXT NOT NULL,
  posted_at TEXT,
  channel_message_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS errors(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "where" TEXT,
  message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const upsert = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const defaults = {
  duty_enabled: 'false',
  mode: 'manual',
  dedup_window_min: String(config.app.dedupWindowMin),
  autopost_unverified_day: String(config.app.autopostUnverifiedDay),
  allow_a_alarms_in_manual: String(config.app.allowAAlarmsInManual),
  confirm_count: String(config.alerts.confirmCount),
  cooldown_seconds: String(config.alerts.cooldownSeconds),
};
for (const [k, v] of Object.entries(defaults)) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
  if (!row) upsert.run(k, v);
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  upsert.run(key, String(value));
}

export default db;
