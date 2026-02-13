import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from './config.js';

export async function createClient() {
  const session = new StringSession(config.tgSessionString);
  const client = new TelegramClient(session, config.tgApiId, config.tgApiHash, {
    connectionRetries: 5
  });

  await client.connect();
  console.log('GRAMJS_CONNECTED');

  return client;
}
