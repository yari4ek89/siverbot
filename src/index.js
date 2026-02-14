import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { createClient } from './gramjsClient.js';
import { ChannelFetcher } from './channelFetcher.js';

const bot = new Telegraf(config.botToken);
const PID = process.pid;
const INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let gramStatus = {
  enabled: false,
  initialized: false,
  lastInitError: null,
  lastTickError: null,
  lastTickAt: null,
  lastTickFetched: 0,
  lastTickNew: 0
};
let channelFetcher = null;
let validSourceChannels = [];
let invalidSourceChannels = [];
let isLaunched = false;

function isAdmin(ctx) {
  return Number(ctx.from?.id) === config.adminUserId;
}

function formatTickDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('uk-UA');
}

function compactText(text, max = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function sanitizeChannels(channels) {
  const valid = [];
  const invalid = [];

  for (const raw of channels) {
    const ch = String(raw || '').trim();
    if (!ch) continue;
    if (!ch.startsWith('@') || /\s/.test(ch)) {
      invalid.push(ch);
      continue;
    }
    valid.push(ch);
  }

  return { valid, invalid };
}

function getMissingGramEnv() {
  const missing = [];
  if (!config.tgApiId && config.tgApiId !== 0) missing.push('TG_API_ID');
  if (!config.tgApiHash) missing.push('TG_API_HASH');
  if (!config.tgSessionString) missing.push('TG_SESSION_STRING');
  if (!config.sourceChannels || config.sourceChannels.length === 0) missing.push('SOURCE_CHANNELS');

  if (config.tgApiId !== null && !Number.isFinite(config.tgApiId)) {
    missing.push('TG_API_ID not number');
  }

  return missing;
}

async function sendToTarget(text) {
  await bot.telegram.sendMessage(config.targetChatId, text, {
    disable_web_page_preview: true
  });
}

async function postIncomingText(text, sourceName = null) {
  await sendToTarget(text);
  console.log(`POST_OK pid=${PID} instance=${INSTANCE_ID} target=${config.targetChatId}${sourceName ? ` source=${sourceName}` : ''}`);
}

async function initGramIfPossible() {
  const missing = getMissingGramEnv();
  const { valid, invalid } = sanitizeChannels(config.sourceChannels);
  validSourceChannels = valid;
  invalidSourceChannels = invalid;

  if (missing.length > 0 || validSourceChannels.length === 0) {
    gramStatus.enabled = false;
    gramStatus.initialized = false;
    const reasons = [...missing];
    if (validSourceChannels.length === 0) reasons.push('SOURCE_CHANNELS has no valid channels');
    gramStatus.lastInitError = `missing env: ${reasons.join(', ')}`;
    console.log(`GRAM_DISABLED ${gramStatus.lastInitError}`);
    return;
  }

  gramStatus.enabled = true;

  try {
    const client = await createClient();
    channelFetcher = new ChannelFetcher(client, validSourceChannels, config.fetchLimit);
    gramStatus.initialized = true;
    gramStatus.lastInitError = null;
  } catch (error) {
    gramStatus.initialized = false;
    gramStatus.lastInitError = error?.stack || error?.message || String(error);
    console.error('GRAM_INIT_ERR', error);
  }
}

bot.use(async (ctx, next) => {
  console.log(`HANDLER_MIDDLEWARE pid=${PID} instance=${INSTANCE_ID}`);

  if (!ctx.from) return;
  if (ctx.message?.text?.startsWith('/')) return next();

  if (!isAdmin(ctx)) {
    console.log(`IGNORE pid=${PID} instance=${INSTANCE_ID} from=${ctx.from.id} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  await next();
});

bot.start((ctx) => {
  console.log(`HANDLER_START pid=${PID} instance=${INSTANCE_ID}`);
  if (!isAdmin(ctx)) return;
  ctx.reply('Готово. Я принимаю сообщения только от админа.');
});

bot.command('ping', (ctx) => {
  console.log(`HANDLER_COMMAND ping pid=${PID} instance=${INSTANCE_ID}`);
  if (!isAdmin(ctx)) return;
  ctx.reply('pong');
});

bot.command('debug', (ctx) => {
  console.log(`HANDLER_COMMAND debug pid=${PID} instance=${INSTANCE_ID}`);
  if (!isAdmin(ctx)) return;
  ctx.reply(
    `admin=${config.adminUserId} | here_chat=${ctx.chat.id} | target=${config.targetChatId} | from=${ctx.from.id} | pid=${PID} instance=${INSTANCE_ID}`
  );
});

bot.command('sources', (ctx) => {
  console.log(`HANDLER_COMMAND sources pid=${PID} instance=${INSTANCE_ID}`);
  if (!isAdmin(ctx)) return;

  const parsed = config.sourceChannels.length ? config.sourceChannels.join(', ') : '(empty)';
  const map = channelFetcher ? channelFetcher.getLastMsgIdMap() : new Map();
  const channelLines = validSourceChannels.map((ch) => `${ch}: lastMsgId=${map.get(ch) ?? '-'}`);

  return ctx.reply(
    [
      `enabled=${gramStatus.enabled}`,
      `initialized=${gramStatus.initialized}`,
      `parsedChannels=${parsed}`,
      `invalid channels skipped=${invalidSourceChannels.length ? invalidSourceChannels.join(', ') : '-'}`,
      ...channelLines,
      `lastInitError=${gramStatus.lastInitError || '-'}`,
      `lastTickAt=${formatTickDate(gramStatus.lastTickAt)}`,
      `lastTickFetched=${gramStatus.lastTickFetched}`,
      `lastTickNew=${gramStatus.lastTickNew}`,
      `lastTickError=${gramStatus.lastTickError || '-'}`
    ].join('\n')
  );
});

bot.command('postlast', async (ctx) => {
  console.log(`HANDLER_COMMAND postlast pid=${PID} instance=${INSTANCE_ID}`);
  if (!isAdmin(ctx)) return;

  if (!channelFetcher) {
    return ctx.reply(`Fetcher not initialized: ${gramStatus.lastInitError || 'unknown error'}`);
  }

  const firstChannel = validSourceChannels[0];
  if (!firstChannel) {
    return ctx.reply('Fetcher not initialized: no valid SOURCE_CHANNELS');
  }

  try {
    const last = await channelFetcher.getLatestFromChannel(firstChannel);
    if (!last?.text) {
      return ctx.reply(`No text message in ${firstChannel}`);
    }

    await postIncomingText(`[TEST_POSTLAST]\n${last.text}`, last.sourceName);
    return ctx.reply(`Posted [TEST_POSTLAST] from ${firstChannel} #${last.msgId}`);
  } catch (error) {
    gramStatus.lastTickError = error?.stack || error?.message || String(error);
    return ctx.reply(`postlast error: ${error?.message || String(error)}`);
  }
});

bot.command('pull', async (ctx) => {
  console.log(`HANDLER_COMMAND pull pid=${PID} instance=${INSTANCE_ID}`);
  if (!isAdmin(ctx)) return;

  if (!channelFetcher) {
    return ctx.reply(`Fetcher not initialized: ${gramStatus.lastInitError || 'unknown error'}`);
  }

  try {
    const { items, fetchedCount } = await pollChannels({ manual: true });
    const preview = items
      .slice(0, 2)
      .map((it) => `${it.sourceName} #${it.msgId}: ${compactText(it.text, 60)}`)
      .join('\n');

    return ctx.reply(
      [
        `newCount=${items.length}`,
        `fetchedCount=${fetchedCount}`,
        `lastError=${gramStatus.lastTickError || '-'}`,
        preview ? `sample:\n${preview}` : null
      ]
        .filter(Boolean)
        .join('\n')
    );
  } catch (error) {
    return ctx.reply(
      `newCount=0\nfetchedCount=${gramStatus.lastTickFetched}\nlastError=${error?.message || String(error)}`
    );
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text?.trim();
  if (!text || text.startsWith('/')) return;

  console.log(`MSG_IN pid=${PID} instance=${INSTANCE_ID} from=${ctx.from.id} chat=${ctx.chat.id} text=${JSON.stringify(text)}`);
  await postIncomingText(text);
  await ctx.reply('Отправлено.');
});

bot.catch((err) => {
  console.error(`BOT_ERROR pid=${PID} instance=${INSTANCE_ID}`, err);
});

async function pollChannels({ manual = false } = {}) {
  if (!channelFetcher) {
    return { items: [], fetchedCount: 0 };
  }

  console.log(`CH_TICK start pid=${PID} instance=${INSTANCE_ID}${manual ? ' manual=1' : ''}`);

  try {
    const { items, fetchedCount, perChannel } = await channelFetcher.tick();
    gramStatus.lastTickAt = Date.now();
    gramStatus.lastTickFetched = fetchedCount;
    gramStatus.lastTickNew = items.length;
    gramStatus.lastTickError = null;

    for (const ch of perChannel) {
      console.log(`CH_FETCH channel=${ch.channel} fetched=${ch.fetched} maxId=${ch.maxId} lastIdBefore=${ch.lastIdBefore} new=${ch.newCount}`);
    }

    console.log(`CH_TICK done newTotal=${items.length}`);

    for (const item of items) {
      await postIncomingText(item.text, item.sourceName);
    }

    return { items, fetchedCount, perChannel };
  } catch (error) {
    gramStatus.lastTickError = error?.stack || error?.message || String(error);
    console.error(`CH_FETCH_ERR pid=${PID} instance=${INSTANCE_ID}`, error);
    return { items: [], fetchedCount: 0 };
  }
}

async function main() {
  if (isLaunched) return;
  isLaunched = true;

  console.log(`START pid=${PID} instance=${INSTANCE_ID}`);
  await bot.launch();

  await initGramIfPossible();

  setInterval(() => {
    if (!channelFetcher) return;
    void pollChannels();
  }, 15_000);
}

void main();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
