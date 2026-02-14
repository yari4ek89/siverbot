import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from './config.js';

export async function createClient() {
  if (!Number.isFinite(config.tgApiId)) {
    throw new Error('TG_API_ID not number');
  }

  const session = new StringSession(config.tgSessionString || '');
  const client = new TelegramClient(session, config.tgApiId, config.tgApiHash, {
    connectionRetries: 5
  });

  await client.connect();
  console.log('GRAMJS_CONNECTED');

  return client;
}
