import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { AlertsWatcher } from './alertsWatcher.js';

const bot = new Telegraf(config.botToken);
const watcher = new AlertsWatcher({
  token: config.alertsToken,
  regionTitles: config.alertsRegionTitles
});

let pollingInProgress = false;
let skippedTicks = 0;

function isAdmin(ctx) {
  return Number(ctx.from?.id) === config.adminUserId;
}

function nowLocalTime() {
  return new Date().toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

async function sendToTarget(text) {
  await bot.telegram.sendMessage(config.targetChatId, text, {
    disable_web_page_preview: true
  });
}

async function notifyAdmin(text) {
  if (!config.adminUserId) return;

  try {
    await bot.telegram.sendMessage(config.adminUserId, text, {
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error('ADMIN_NOTIFY_ERROR', error);
  }
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

bot.command('alerts', (ctx) => {
  const activeNow = [...watcher.prevActive].map((key) => key.split('|')[2]).filter(Boolean);

  if (activeNow.length === 0) {
    return ctx.reply('Немає активних тривог');
  }

  return ctx.reply(`Активні тривоги:\n${activeNow.map((x) => `• ${x}`).join('\n')}`);
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text?.trim();
  if (!text || text.startsWith('/')) return;

  console.log(`MSG_IN from=${ctx.from.id} chat=${ctx.chat.id} text=${JSON.stringify(text)}`);

  await sendToTarget(text);

  console.log(`POST_OK target=${config.targetChatId}`);
  await ctx.reply('Отправлено.');
});

bot.catch((err) => {
  console.error('BOT_ERROR', err);
});

async function pollAlerts() {
  if (pollingInProgress) return;
  if (skippedTicks > 0) {
    skippedTicks -= 1;
    return;
  }

  pollingInProgress = true;

  try {
    const result = await watcher.tick();

    for (const oblast of result.started) {
      await sendToTarget(`🚨 Повітряна тривога: ${oblast}\nЧас: ${nowLocalTime()}`);
      console.log(`POST_OK target=${config.targetChatId}`);
    }

    for (const oblast of result.ended) {
      await sendToTarget(`✅ Відбій: ${oblast}\nЧас: ${nowLocalTime()}`);
      console.log(`POST_OK target=${config.targetChatId}`);
    }
  } catch (error) {
    if (error?.status === 401) {
      console.error('ALERTS_AUTH_ERROR 401');
      await notifyAdmin('⚠️ Alerts API: 401 Unauthorized. Перевірте ALERTS_TOKEN.');
    } else if (error?.status === 429) {
      skippedTicks = 2;
      console.error('ALERTS_RATE_LIMIT 429: skipping next 2 ticks');
    } else {
      console.error('ALERTS_POLL_ERROR', error);
    }
  } finally {
    pollingInProgress = false;
  }
}

console.log('START');
bot.launch().then(() => {
  void pollAlerts();
  setInterval(() => {
    void pollAlerts();
  }, config.alertsPollSec * 1000);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
