import 'dotenv/config';

const toBool = (v, d = false) => {
  if (v == null || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

export default {
  tg: {
    botToken: process.env.TG_BOT_TOKEN,
    channel: process.env.TG_CHANNEL,
    ownerId: Number(process.env.OWNER_ID || 0),
    adminChatId: process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null,
  },
  alerts: {
    url: process.env.ALERTS_URL,
    token: process.env.ALERTS_TOKEN,
    authHeader: process.env.ALERTS_AUTH_HEADER || 'Authorization',
    authPrefix: process.env.ALERTS_AUTH_PREFIX || 'Bearer',
    pollSeconds: Number(process.env.POLL_SECONDS || 30),
    confirmCount: Number(process.env.CONFIRM_COUNT || 2),
    cooldownSeconds: Number(process.env.COOLDOWN_SECONDS || 60),
    uidOffset: Number(process.env.UID_OFFSET || 0),
    activeSymbols: new Set((process.env.ACTIVE_SYMBOLS || 'A').split(',').map((s) => s.trim()).filter(Boolean)),
  },
  mtproto: {
    apiId: Number(process.env.TG_API_ID || 0),
    apiHash: process.env.TG_API_HASH,
    session: process.env.TG_SESSION || '',
  },
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 8000),
  },
  app: {
    dedupWindowMin: Number(process.env.DEDUP_WINDOW_MIN || 20),
    perSourceCooldownSec: Number(process.env.PER_SOURCE_COOLDOWN_SEC || 120),
    globalRateMax: Number(process.env.GLOBAL_RATE_MAX || 3),
    globalRateWindowMin: Number(process.env.GLOBAL_RATE_WINDOW_MIN || 5),
    digestIntervalMin: Number(process.env.DIGEST_INTERVAL_MIN || 10),
    focusMode: (process.env.FOCUS_MODE || 'shahed').toLowerCase(),
    allowAAlarmsInManual: toBool(process.env.ALLOW_A_ALARMS_IN_MANUAL, false),
    queueUnsafeMode: (process.env.QUEUE_UNSAFE_MODE || 'queue').toLowerCase(),
  },
};
