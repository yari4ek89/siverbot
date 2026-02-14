import "dotenv/config";

const {
  BOT_TOKEN,
  TARGET_CHAT_ID,
  ADMIN_USER_ID,
  TG_API_ID,
  TG_API_HASH,
  TG_SESSION_STRING,
  SOURCE_CHANNELS,
  FETCH_LIMIT
} = process.env;

if (!BOT_TOKEN) {
  throw new Error('Missing required env var: BOT_TOKEN');
}

if (!TARGET_CHAT_ID) {
  throw new Error('Missing required env var: TARGET_CHAT_ID');
}

if (!ADMIN_USER_ID) {
  throw new Error('Missing required env var: ADMIN_USER_ID');
}

const fetchLimit = Number(FETCH_LIMIT || 20);

export const config = {
  botToken: BOT_TOKEN,
  targetChatId: TARGET_CHAT_ID,
  adminUserId: Number(ADMIN_USER_ID),
  tgApiId: TG_API_ID ? Number(TG_API_ID) : null,
  tgApiHash: TG_API_HASH || '',
  tgSessionString: TG_SESSION_STRING || '',
  sourceChannelsRaw: SOURCE_CHANNELS || '',
  sourceChannels: String(SOURCE_CHANNELS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
  fetchLimit: Number.isFinite(fetchLimit) && fetchLimit > 0 ? fetchLimit : 20
};
