import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

export async function createGramClient({ apiId, apiHash, session }) {
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();
  return client;
}
