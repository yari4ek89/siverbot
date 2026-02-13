import { Telegraf } from 'telegraf';
import { config } from './config.js';

const bot = new Telegraf(config.botToken);

function isAdmin(ctx) {
  return Number(ctx.from?.id) === config.adminUserId;
}

bot.use(async (ctx, next) => {
  if (!ctx.from) return;

  if (!isAdmin(ctx)) {
    console.log(`IGNORE from=${ctx.from.id} chat=${ctx.chat?.id ?? 'n/a'}`);
    return;
  }

  await next();
});

bot.start((ctx) => {
  ctx.reply('Готово. Я принимаю сообщения только от админа.');
});

bot.command('ping', (ctx) => {
  ctx.reply('pong');
});

bot.command('debug', (ctx) => {
  ctx.reply(
    `admin=${config.adminUserId} | here_chat=${ctx.chat.id} | target=${config.targetChatId} | from=${ctx.from.id}`
  );
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text?.trim();
  if (!text || text.startsWith('/')) return;

  console.log(`MSG_IN from=${ctx.from.id} chat=${ctx.chat.id} text=${JSON.stringify(text)}`);

  await ctx.telegram.sendMessage(config.targetChatId, text, {
    disable_web_page_preview: true
  });

  console.log(`POST_OK target=${config.targetChatId}`);
  await ctx.reply('Отправлено.');
});

bot.catch((err) => {
  console.error('BOT_ERROR', err);
});

console.log('START');
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
