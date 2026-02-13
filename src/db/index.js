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
  trust_level TEXT DEFAULT 'B',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_id INTEGER,
  source_name TEXT,
  trust_level TEXT,
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
  source_ref TEXT,
  posted_at TEXT,
  channel_message_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  preview_redacted TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS errors(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "where" TEXT,
  message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clusters(
  signature TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);


function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn('events', 'source_name', 'source_name TEXT');
ensureColumn('events', 'trust_level', 'trust_level TEXT');
ensureColumn('published', 'source_ref', 'source_ref TEXT');
ensureColumn('queue', 'preview_redacted', 'preview_redacted TEXT');

const upsert = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const defaults = {
  duty_enabled: 'false',
  mode: 'manual',
  focus_mode: config.app.focusMode,
  dedup_window_min: String(config.app.dedupWindowMin),
  per_source_cooldown_sec: String(config.app.perSourceCooldownSec),
  global_rate_max: String(config.app.globalRateMax),
  global_rate_window_min: String(config.app.globalRateWindowMin),
  digest_interval_min: String(config.app.digestIntervalMin),
  last_suppressed_count: '0',
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
