import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { StringSession } from 'telegram/sessions/index.js';
import { TelegramClient } from 'telegram';

const apiId = Number(process.env.TG_API_ID || 0);
const apiHash = process.env.TG_API_HASH || '';

if (!apiId || !apiHash) {
  console.error('Set TG_API_ID and TG_API_HASH in .env first');
  process.exit(1);
}

const rl = createInterface({ input, output });
const ask = (q) => rl.question(q);

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

await client.start({
  phoneNumber: async () => ask('Phone: '),
  password: async () => ask('2FA password (if any): '),
  phoneCode: async () => ask('Code from Telegram: '),
  onError: (err) => console.error(err),
});

console.log('\nTG_SESSION=');
console.log(client.session.save());

await client.disconnect();
rl.close();
