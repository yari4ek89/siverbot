import 'dotenv/config';

const required = [
  'BOT_TOKEN',
  'TARGET_CHAT_ID',
  'ADMIN_USER_ID',
  'TG_API_ID',
  'TG_API_HASH',
  'TG_SESSION_STRING',
  'SOURCE_CHANNELS',
];

function getRequired(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function parseChannelList(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

for (const key of required) getRequired(key);

const tgApiId = Number(getRequired('TG_API_ID'));
if (!Number.isFinite(tgApiId)) {
  throw new Error(`TG_API_ID must be a number, got: ${process.env.TG_API_ID}`);
}

const sourceChannelsRaw = getRequired('SOURCE_CHANNELS').split(',').map((s) => s.trim()).filter(Boolean);
const invalidSourceChannels = sourceChannelsRaw.filter((ch) => !ch.startsWith('@'));
const sourceChannels = sourceChannelsRaw.filter((ch) => ch.startsWith('@'));

if (sourceChannels.length === 0) {
  throw new Error('SOURCE_CHANNELS must include at least one valid channel starting with @');
}

const llmMode = (process.env.LLM_MODE || 'off').trim().toLowerCase();

export const config = {
  botToken: getRequired('BOT_TOKEN'),
  targetChatId: getRequired('TARGET_CHAT_ID'),
  adminUserId: Number(getRequired('ADMIN_USER_ID')),
  tgApiId,
  tgApiHash: getRequired('TG_API_HASH'),
  tgSessionString: getRequired('TG_SESSION_STRING'),
  sourceChannelsRaw,
  sourceChannels,
  invalidSourceChannels,
  uavOnlySources: parseChannelList(process.env.UAV_ONLY_SOURCES),
  missileOnlySources: parseChannelList(process.env.MISSILE_ONLY_SOURCES),
  fetchIntervalSec: Number(process.env.FETCH_INTERVAL_SEC ?? 15),
  fetchLimit: Number(process.env.FETCH_LIMIT ?? 20),
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 12000),
  llmMode: ['off', 'smart'].includes(llmMode) ? llmMode : 'off',
  regions: (process.env.REGIONS || 'chernihiv,sumy').split(',').map((x) => x.trim().toLowerCase()),
  minSourcesDay: Number(process.env.MIN_SOURCES_DAY ?? 2),
  minSourcesNight: Number(process.env.MIN_SOURCES_NIGHT ?? 1),
  dayStart: process.env.DAY_START || '07:00',
  dayEnd: process.env.DAY_END || '23:00',
  confirmWindowMin: Number(process.env.CONFIRM_WINDOW_MIN ?? 20),
  dedupTtlMin: Number(process.env.DEDUP_TTL_MIN ?? 240),
  stateFile: process.env.STATE_FILE || './data/state.json',
  logLevel: process.env.LOG_LEVEL || 'info',
};

if (!Number.isFinite(config.adminUserId)) {
  throw new Error(`ADMIN_USER_ID must be a number, got: ${process.env.ADMIN_USER_ID}`);
}
