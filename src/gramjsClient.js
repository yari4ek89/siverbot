import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

export async function createGramClient({ apiId, apiHash, sessionString }) {
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
    return client;
  } catch (error) {
    throw new Error(`GramJS connect failed: ${error?.stack || error?.message || String(error)}`);
  }
}
