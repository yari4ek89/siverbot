import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { createClient } from './gramjsClient.js';
import { ChannelFetcher } from './channelFetcher.js';

const bot = new Telegraf(config.botToken);

let channelFetcher = null;
let isLaunched = false;

function isAdmin(ctx) {
  return Number(ctx.from?.id) === config.adminUserId;
}

async function sendToTarget(text) {
  await bot.telegram.sendMessage(config.targetChatId, text, {
    disable_web_page_preview: true
  });
}

async function postIncomingText(text, sourceName = null) {
  await sendToTarget(text);
  console.log(`POST_OK target=${config.targetChatId}${sourceName ? ` source=${sourceName}` : ''}`);
}

bot.use(async (ctx, next) => {
  console.log('HANDLER_MIDDLEWARE');

  if (!ctx.from) return;

  if (ctx.message?.text?.startsWith('/')) {
    return next();
  }

  if (!isAdmin(ctx)) {
    console.log(`IGNORE from=${ctx.from.id} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  await next();
});

bot.start((ctx) => {
  console.log('HANDLER_START');

  if (!isAdmin(ctx)) {
    console.log(`IGNORE from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  ctx.reply('Готово. Я принимаю сообщения только от админа.');
});

bot.command('ping', (ctx) => {
  console.log('HANDLER_COMMAND ping');

  if (!isAdmin(ctx)) {
    console.log(`IGNORE from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  ctx.reply('pong');
});

bot.command('debug', (ctx) => {
  console.log('HANDLER_COMMAND debug');

  if (!isAdmin(ctx)) {
    console.log(`IGNORE from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  ctx.reply(
    `admin=${config.adminUserId} | here_chat=${ctx.chat.id} | target=${config.targetChatId} | from=${ctx.from.id}`
  );
});

bot.command('sources', (ctx) => {
  console.log('HANDLER_COMMAND sources');

  if (!isAdmin(ctx)) {
    console.log(`IGNORE from=${ctx.from?.id ?? 'n/a'} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  if (!channelFetcher) {
    return ctx.reply('Source fetcher ще не ініціалізовано');
  }

  const map = channelFetcher.getLastMsgIdMap();
  const lines = config.sourceChannels.map((ch) => `${ch}: ${map.get(ch) || '-'}`);
  return ctx.reply(`Sources:\n${lines.join('\n')}`);
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text?.trim();
  if (!text || text.startsWith('/')) return;

  console.log(`MSG_IN from=${ctx.from.id} chat=${ctx.chat.id} text=${JSON.stringify(text)}`);

  await postIncomingText(text);
  await ctx.reply('Отправлено.');
});

bot.catch((err) => {
  console.error('BOT_ERROR', err);
});

async function pollChannels() {
  if (!channelFetcher) return;

  try {
    const newItems = await channelFetcher.tick();
    console.log(`CH_FETCH_OK channels=${config.sourceChannels.length}`);

    if (newItems.length > 0) {
      console.log(`CH_NEW ${newItems.length}`);
    }

    for (const item of newItems) {
      await postIncomingText(item.text, item.sourceName);
    }
  } catch (error) {
    console.error('CH_FETCH_ERR', error);
  }
}

async function main() {
  if (isLaunched) return;
  isLaunched = true;

  console.log('START');
  await bot.launch();

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
