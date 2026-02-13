import 'dotenv/config';

const {
  BOT_TOKEN,
  TARGET_CHAT_ID,
  ADMIN_USER_ID,
  ALERTS_TOKEN,
  ALERTS_POLL_SEC,
  ALERTS_REGION_TITLES
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

if (!ALERTS_TOKEN) {
  throw new Error('Missing required env var: ALERTS_TOKEN');
}

const pollSec = Number(ALERTS_POLL_SEC || 20);

export const config = {
  botToken: BOT_TOKEN,
  targetChatId: TARGET_CHAT_ID,
  adminUserId: Number(ADMIN_USER_ID),
  alertsToken: ALERTS_TOKEN,
  alertsPollSec: Number.isFinite(pollSec) && pollSec > 0 ? pollSec : 20,
  alertsRegionTitles: new Set(
    String(ALERTS_REGION_TITLES || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  )
};
