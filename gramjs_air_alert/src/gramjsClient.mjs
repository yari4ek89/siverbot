import { TelegramClient } from "gramjs";
import { StringSession } from "gramjs/sessions/index.js";

export async function createGramJsClient({ apiId, apiHash, session }) {
  const stringSession = new StringSession(session);
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
  });

  await client.connect();
  return client;
}

export async function resolveEntity(client, value) {
  return client.getEntity(value);
}
