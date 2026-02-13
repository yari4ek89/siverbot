import config from './config.js';
import logger from './logger.js';
import db, { getSetting, setSetting } from './db/index.js';
import AlertsPoller from './alerts/poller.js';
import MTProtoCollector from './mtproto/collector.js';
import Pipeline from './pipeline/engine.js';
import AdminBot from './bot/adminBot.js';

async function main() {
  if (!config.tg.botToken || !config.tg.channel || !config.alerts.url || !config.alerts.token) {
    throw new Error('Потрібні TG_BOT_TOKEN, TG_CHANNEL, ALERTS_URL, ALERTS_TOKEN');
  }

  let pipeline;
  const mtproto = new MTProtoCollector({ db, logger, onEvent: async (event) => pipeline.ingest(event) });
  const admin = new AdminBot({ config, db, getSetting, setSetting, pipeline: { approve: (...a) => pipeline.approve(...a), reject: (...a) => pipeline.reject(...a) }, mtproto, logger });
  pipeline = new Pipeline({ db, getSetting, bot: admin.bot, logger });

  const alerts = new AlertsPoller({ onEvent: async (event) => pipeline.ingest(event), logger, getSetting });

  await admin.launch();
  logger.info('Адмін-бот запущено');

  await mtproto.start();
  alerts.start();
  logger.info('Poller тривог запущено');

  const shutdown = async () => {
    alerts.stop();
    admin.bot.stop('SIGTERM');
    if (mtproto.client) await mtproto.client.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  logger.error({ err: e.message }, 'Фатальна помилка');
  process.exit(1);
});
