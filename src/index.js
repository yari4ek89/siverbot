import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { createClient } from './gramjsClient.js';
import { ChannelFetcher } from './channelFetcher.js';

const bot = new Telegraf(config.botToken);
const PID = process.pid;
const INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let channelFetcher = null;
let isLaunched = false;

function isAdmin(ctx) {
  return Number(ctx.from?.id) === config.adminUserId;
}

function formatTickDate(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('uk-UA');
}

function compactText(text, max = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
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

bot.use(async (ctx, next) => {
  console.log(`HANDLER_MIDDLEWARE pid=${PID} instance=${INSTANCE_ID}`);

  if (!ctx.from) return;

  if (ctx.message?.text?.startsWith('/')) {
    return next();
  }

  if (!isAdmin(ctx)) {
    console.log(`IGNORE pid=${PID} instance=${INSTANCE_ID} from=${ctx.from.id} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  await next();
});

bot.start((ctx) => {
  console.log(`HANDLER_START pid=${PID} instance=${INSTANCE_ID}`);

  if (!isAdmin(ctx)) {
    console.log(`IGNORE pid=${PID} instance=${INSTANCE_ID} from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  ctx.reply('Готово. Я принимаю сообщения только от админа.');
});

bot.command('ping', (ctx) => {
  console.log(`HANDLER_COMMAND ping pid=${PID} instance=${INSTANCE_ID}`);

  if (!isAdmin(ctx)) {
    console.log(`IGNORE pid=${PID} instance=${INSTANCE_ID} from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  ctx.reply('pong');
});

bot.command('debug', (ctx) => {
  console.log(`HANDLER_COMMAND debug pid=${PID} instance=${INSTANCE_ID}`);

  if (!isAdmin(ctx)) {
    console.log(`IGNORE pid=${PID} instance=${INSTANCE_ID} from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  ctx.reply(
    `admin=${config.adminUserId} | here_chat=${ctx.chat.id} | target=${config.targetChatId} | from=${ctx.from.id} | pid=${PID} instance=${INSTANCE_ID}`
  );
});

bot.command('sources', (ctx) => {
  console.log(`HANDLER_COMMAND sources pid=${PID} instance=${INSTANCE_ID}`);

  if (!isAdmin(ctx)) {
    console.log(`IGNORE pid=${PID} instance=${INSTANCE_ID} from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  const parsed = config.sourceChannels.length > 0 ? config.sourceChannels.join(', ') : '(empty)';

  if (!config.gramEnabled) {
    return ctx.reply(
      `GramJS disabled\nmissing=${config.gramMissingEnv.join(', ')}\nsourceChannelsParsed=${parsed}`
    );
  }

  if (!channelFetcher) {
    return ctx.reply(`Source fetcher ще не ініціалізовано\nsourceChannelsParsed=${parsed}`);
  }

  const map = channelFetcher.getLastMsgIdMap();
  const stats = channelFetcher.getDiagnostics();
  const lines = config.sourceChannels.map((ch) => `${ch}: lastMsgId=${map.get(ch) || '-'}`);

  return ctx.reply(
    [
      `sourceChannelsParsed=${parsed}`,
      ...lines,
      `lastTickAt=${formatTickDate(stats.lastTickAt)}`,
      `lastTickFetchedCount=${stats.lastTickFetchedCount}`,
      `lastTickNewCount=${stats.lastTickNewCount}`,
      `lastError=${stats.lastError || '-'}`
    ].join('\n')
  );
});

bot.command('pull', async (ctx) => {
  console.log(`HANDLER_COMMAND pull pid=${PID} instance=${INSTANCE_ID}`);

  if (!isAdmin(ctx)) {
    console.log(`IGNORE pid=${PID} instance=${INSTANCE_ID} from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  if (!config.gramEnabled) {
    return ctx.reply(`GramJS disabled\nmissing=${config.gramMissingEnv.join(', ')}`);
  }

  if (!channelFetcher) {
    return ctx.reply('Source fetcher ще не ініціалізовано');
  }

  try {
    const result = await pollChannels({ manual: true });
    const preview = result.items
      .slice(0, 2)
      .map((it) => `${it.sourceName} #${it.msgId}: ${compactText(it.text, 60)}`)
      .join('\n');

    return ctx.reply(
      [
        `newCount=${result.newCount}`,
        `fetchedCount=${result.fetchedCount}`,
        `lastError=${channelFetcher.getDiagnostics().lastError || '-'}`,
        preview ? `sample:\n${preview}` : null
      ]
        .filter(Boolean)
        .join('\n')
    );
  } catch (error) {
    return ctx.reply(
      `newCount=0\nfetchedCount=${channelFetcher.getDiagnostics().lastTickFetchedCount}\nlastError=${error?.message || String(error)}`
    );
  }
});

bot.command('postlast', async (ctx) => {
  console.log(`HANDLER_COMMAND postlast pid=${PID} instance=${INSTANCE_ID}`);

  if (!isAdmin(ctx)) {
    console.log(`IGNORE pid=${PID} instance=${INSTANCE_ID} from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  if (!config.gramEnabled) {
    return ctx.reply(`GramJS disabled\nmissing=${config.gramMissingEnv.join(', ')}`);
  }

  if (!channelFetcher) {
    return ctx.reply('Source fetcher ще не ініціалізовано');
  }

  const firstChannel = config.sourceChannels[0];
  if (!firstChannel) {
    return ctx.reply('SOURCE_CHANNELS порожній');
  }

  try {
    const last = await channelFetcher.getLatestFromChannel(firstChannel);
    if (!last || !last.text) {
      return ctx.reply(`Немає текстового повідомлення в ${firstChannel}`);
    }

    await postIncomingText(`[TEST_POSTLAST]\n${last.text}`, last.sourceName);
    return ctx.reply(`Опубліковано test post з ${firstChannel} #${last.msgId}`);
  } catch (error) {
    return ctx.reply(`postlast error: ${error?.message || String(error)}`);
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
    return { items: [], fetchedCount: 0, newCount: 0, perChannel: [] };
  }

  console.log(`CH_TICK start pid=${PID} instance=${INSTANCE_ID}${manual ? ' manual=1' : ''}`);

  try {
    const result = await channelFetcher.tick();

    for (const ch of result.perChannel) {
      console.log(
        `CH_FETCH channel=${ch.channel} fetched=${ch.fetched} maxId=${ch.maxId} lastIdBefore=${ch.lastIdBefore} new=${ch.newCount}`
      );
    }

    console.log(`CH_TICK done newTotal=${result.newCount}`);

    if (result.newCount > 0) {
      console.log(`CH_NEW pid=${PID} instance=${INSTANCE_ID} ${result.newCount}`);
    }

    for (const item of result.items) {
      await postIncomingText(item.text, item.sourceName);
    }

    return result;
  } catch (error) {
    console.error(`CH_FETCH_ERR pid=${PID} instance=${INSTANCE_ID}`, error);
    throw error;
  }
}

async function main() {
  if (isLaunched) return;
  isLaunched = true;

  console.log(`START pid=${PID} instance=${INSTANCE_ID}`);
  await bot.launch();

  if (!config.gramEnabled) {
    console.log(`GRAM_DISABLED missing env: ${config.gramMissingEnv.join(", ")}`);
    return;
  }

  const gramClient = await createClient();
  channelFetcher = new ChannelFetcher(gramClient, config.sourceChannels, config.fetchLimit);

  void pollChannels();
  setInterval(() => {
    void pollChannels();
  }, 15_000);
}

void main();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
