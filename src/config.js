import 'dotenv/config';

const { BOT_TOKEN, TARGET_CHAT_ID, ADMIN_USER_ID } = process.env;

if (!BOT_TOKEN) {
  throw new Error('Missing required env var: BOT_TOKEN');
}

if (!TARGET_CHAT_ID) {
  throw new Error('Missing required env var: TARGET_CHAT_ID');
}

if (!ADMIN_USER_ID) {
  throw new Error('Missing required env var: ADMIN_USER_ID');
}

export const config = {
  botToken: BOT_TOKEN,
  targetChatId: TARGET_CHAT_ID,
  adminUserId: Number(ADMIN_USER_ID)
};
