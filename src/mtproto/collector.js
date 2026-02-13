import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import config from '../config.js';

export default class MTProtoCollector {
  constructor({ db, logger, onEvent }) {
    this.db = db;
    this.logger = logger;
    this.onEvent = onEvent;
    this.client = null;
  }

  async start() {
    if (!config.mtproto.apiId || !config.mtproto.apiHash || !config.mtproto.session) {
      this.logger.warn('MTProto вимкнено: TG_API_ID/TG_API_HASH/TG_SESSION не задані');
      return;
    }
    this.client = new TelegramClient(new StringSession(config.mtproto.session), config.mtproto.apiId, config.mtproto.apiHash, { connectionRetries: 5 });
    await this.client.connect();
    this.logger.info('MTProto підключено');

    this.client.addEventHandler(async (event) => {
      const msg = event.message;
      const chatId = msg.peerId?.channelId?.toString?.();
      if (!chatId) return;
      const src = this.db.prepare('SELECT id, title, username FROM sources WHERE chat_id=? AND enabled=1').get(chatId);
      if (!src) return;
      const text = (msg.message || '').trim();
      if (!text) return;

      await this.onEvent({
        source: 'mtproto',
        source_id: src.id,
        source_ref: chatId,
        msg_id: String(msg.id),
        date: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
        raw_text: text,
        normalized_text: text.replace(/\s+/g, ' ').slice(0, 800),
        category: 'unverified_report',
      });
    }, new NewMessage({}));
  }

  async resolveChannel(input) {
    if (!this.client) throw new Error('MTProto клієнт не запущено');
    const entity = await this.client.getEntity(input);
    return {
      chat_id: entity.id.toString(),
      username: entity.username ? `@${entity.username}` : null,
      title: entity.title || entity.firstName || input,
    };
  }
}
