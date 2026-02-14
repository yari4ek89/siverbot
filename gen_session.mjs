import 'dotenv/config';
import input from 'input';
import { TelegramClient } from 'telegram';
import { createRequire } from 'node:module';

let StringSession;
try {
  ({ StringSession } = await import('telegram/sessions'));
} catch {
  try {
    ({ StringSession } = await import('telegram/sessions/index.js'));
  } catch {
    const require = createRequire(import.meta.url);
    ({ StringSession } = require('telegram/sessions'));
  }
}

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;

if (!Number.isFinite(apiId) || !apiHash) {
  console.error('Set TG_API_ID (number) and TG_API_HASH in .env before running gen:session');
  process.exit(1);
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 5,
});

try {
  await client.start({
    phoneNumber: async () => input.text('phoneNumber (+380...): '),
    phoneCode: async () => input.text('phoneCode: '),
    password: async () => input.text('2FA password (if any): '),
    onError: (err) => console.error('Auth error:', err?.message || err),
  });

  const session = client.session.save();
  console.log('\nTG_SESSION_STRING=');
  console.log(session);
  await client.disconnect();
  process.exit(0);
} catch (error) {
  console.error('Failed to generate session:', error);
  process.exit(1);
}
