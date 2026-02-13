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
    this.connected = false;
    this.lastError = null;
    this.reconnectTimer = null;
    this.started = false;
  }

  validateConfig() {
    if (!config.mtproto.apiId || Number.isNaN(config.mtproto.apiId)) return 'TG_API_ID не заданий або невалідний';
    if (!config.mtproto.apiHash) return 'TG_API_HASH не заданий';
    if (!config.mtproto.session) return 'TG_SESSION не заданий';
    return null;
  }

  getStatus() {
    const configError = this.validateConfig();
    return {
      connected: Boolean(this.connected && this.client?.connected),
      configured: !configError,
      reason: this.lastError || configError || 'OK',
    };
  }

  async connectOnce() {
    const configError = this.validateConfig();
    if (configError) {
      this.connected = false;
      this.lastError = configError;
      this.logger.error({ mtproto_reason: configError }, 'MTProto не ініціалізовано через конфіг');
      return false;
    }

    try {
      if (!this.client) {
        this.client = new TelegramClient(
          new StringSession(config.mtproto.session),
          config.mtproto.apiId,
          config.mtproto.apiHash,
          { connectionRetries: 5 },
        );
      }

      await this.client.connect();
      this.connected = true;
      this.lastError = null;
      this.logger.info('MTProto підключено');

      if (!this.started) {
        this.started = true;
        this.client.addEventHandler(async (event) => {
          const msg = event.message;
          const chatId = msg.peerId?.channelId?.toString?.();
          if (!chatId) return;

          const src = this.db.prepare("SELECT id, COALESCE(username,title,chat_id) AS source_name, COALESCE(trust_level,'B') AS trust_level FROM sources WHERE chat_id=? AND enabled=1").get(chatId);
          if (!src) return;

          const text = (msg.message || '').trim();
          if (!text) return;

          await this.onEvent({
            source: 'mtproto',
            source_id: src.id,
            source_name: src.source_name,
            trust_level: String(src.trust_level || 'B').toUpperCase(),
            source_ref: chatId,
            msg_id: String(msg.id),
            date: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
            raw_text: text,
            normalized_text: text.replace(/\s+/g, ' ').slice(0, 800),
            category: 'unverified_report',
          });
        }, new NewMessage({}));
      }

      return true;
    } catch (e) {
      this.connected = false;
      this.lastError = `Помилка підключення: ${e.message}`;
      this.logger.error({ err: e.message }, 'MTProto connect error');
      return false;
    }
  }

  async start() {
    await this.connectOnce();

    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.reconnectTimer = setInterval(async () => {
      if (this.client?.connected) {
        this.connected = true;
        return;
      }
      this.connected = false;
      await this.connectOnce();
    }, 15000);
  }

  async resolveChannel(input) {
    const status = this.getStatus();
    if (!status.connected) {
      throw new Error(`MTProto не підключено: ${status.reason}`);
    }

    try {
      const entity = await this.client.getEntity(input);
      return {
        chat_id: entity.id.toString(),
        username: entity.username ? `@${entity.username}` : null,
        title: entity.title || entity.firstName || input,
      };
    } catch (e) {
      throw new Error(`Не вдалося resolve канал: ${e.message}`);
    }
  }

  async stop() {
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    if (this.client) await this.client.disconnect();
    this.connected = false;
  }
}
