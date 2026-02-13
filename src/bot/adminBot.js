import { Telegraf, Markup } from 'telegraf';
import { dutyOn, dutyOff, uaMode } from '../pipeline/templates.js';
import { getLlmStatus } from '../pipeline/llm.js';

export default class AdminBot {
  constructor({ config, db, getSetting, setSetting, pipeline, mtproto, logger }) {
    this.db = db;
    this.getSetting = getSetting;
    this.setSetting = setSetting;
    this.pipeline = pipeline;
    this.mtproto = mtproto;
    this.logger = logger;
    this.ownerId = config.tg.ownerId;
    this.adminChatId = config.tg.adminChatId;
    this.bot = new Telegraf(config.tg.botToken);
    this.bot.channel = config.tg.channel;
    this.pendingSourceInput = new Set();
  }

  isAllowed(ctx) {
    const userOk = Number(ctx.from?.id) === this.ownerId;
    const chatOk = this.adminChatId ? Number(ctx.chat?.id) === this.adminChatId : ctx.chat?.type === 'private';
    return userOk && chatOk;
  }

  install() {
    this.bot.use(async (ctx, next) => {
      if (!this.isAllowed(ctx)) return;
      try { await next(); }
      catch (e) {
        this.logger.error({ err: e.message }, 'admin bot error');
        this.db.prepare('INSERT INTO errors("where", message) VALUES(?,?)').run('admin_bot', e.message);
      }
    });

    this.bot.start((ctx) => ctx.reply('Вітаю. Доступні команди: /help'));
    this.bot.help((ctx) => ctx.reply('/duty on|off\n/mode night|day|manual\n/status\n/mtproto\n/focus [shahed|all]\n/queue\n/sources\n/source_add [@username|link]\n/source_set_level <id> A|B|C\n/source_on <id>\n/source_off <id>\n/antispam status\n/health\n/settings\n/set <key> <value>'));

    this.bot.command('duty', async (ctx) => {
      const value = (ctx.message.text.split(' ')[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) return ctx.reply('Використання: /duty on|off');
      this.setSetting('duty_enabled', value === 'on');
      if (value === 'on') await this.bot.telegram.sendMessage(this.bot.channel, dutyOn(this.getSetting('mode', 'manual')));
      else await this.bot.telegram.sendMessage(this.bot.channel, dutyOff());
      return ctx.reply('Готово.');
    });

    this.bot.command('mode', (ctx) => {
      const mode = (ctx.message.text.split(' ')[1] || '').toLowerCase();
      if (!['night', 'day', 'manual'].includes(mode)) return ctx.reply('Використання: /mode night|day|manual');
      this.setSetting('mode', mode);
      return ctx.reply(`Режим: ${uaMode[mode]}`);
    });

    this.bot.command('focus', (ctx) => {
      const mode = (ctx.message.text.split(' ')[1] || '').toLowerCase();
      if (!mode) return ctx.reply(`FOCUS_MODE: ${this.getSetting('focus_mode', 'shahed')}`);
      if (!['shahed', 'all'].includes(mode)) return ctx.reply('Використання: /focus shahed|all');
      this.setSetting('focus_mode', mode);
      return ctx.reply(`FOCUS_MODE оновлено: ${mode}`);
    });

    this.bot.command('status', (ctx) => {
      const queue = this.db.prepare("SELECT COUNT(*) c FROM queue WHERE status='pending'").get().c;
      const last = this.db.prepare('SELECT created_at FROM events ORDER BY id DESC LIMIT 1').get();
      const mt = this.mtproto.getStatus();
      const llm = getLlmStatus();
      return ctx.reply([
        `Чергування: ${this.getSetting('duty_enabled', 'false')}`,
        `Режим: ${uaMode[this.getSetting('mode', 'manual')]}`,
        `Фокус: ${this.getSetting('focus_mode', 'shahed')}`,
        `Остання подія: ${last?.created_at || 'нема'}`,
        `Черга: ${queue}`,
        `MTProto: ${mt.connected ? 'connected' : 'disconnected'} (${mt.reason})`,
        `LLM: ${llm.enabled ? 'enabled' : 'disabled'} (${llm.reason})`,
      ].join('\n'));
    });

    this.bot.command('mtproto', (ctx) => {
      const mt = this.mtproto.getStatus();
      return ctx.reply(`MTProto: ${mt.connected ? 'connected' : 'disconnected'}\nПричина: ${mt.reason}`);
    });

    this.bot.command('antispam', (ctx) => {
      const sub = (ctx.message.text.split(' ')[1] || 'status').toLowerCase();
      if (sub !== 'status') return ctx.reply('Використання: /antispam status');
      const s = this.pipeline.antiSpamStatus();
      return ctx.reply(`Dedup: ${s.dedupWindowMin} хв\nPer-source cooldown: ${s.perSourceCooldownSec} с\nGlobal rate: ${s.globalRateMax}/${s.globalRateWindowMin} хв\nОстанній suppressed: ${s.lastSuppressed}`);
    });

    this.bot.command('queue', async (ctx) => {
      const rows = this.db.prepare(`SELECT q.id,q.reason,q.preview_redacted,e.llm_short,e.normalized_text FROM queue q JOIN events e ON e.id=q.event_id WHERE q.status='pending' ORDER BY q.id DESC LIMIT 10`).all();
      if (!rows.length) return ctx.reply('Черга порожня.');
      for (const row of rows) {
        const preview = row.preview_redacted || row.llm_short || row.normalized_text;
        await ctx.reply(`#${row.id} (${row.reason})\n${String(preview).slice(0, 300)}`, Markup.inlineKeyboard([
          Markup.button.callback('✅ Підтвердити', `approve:${row.id}`),
          Markup.button.callback('❌ Відхилити', `reject:${row.id}`),
        ]));
      }
    });

    this.bot.action(/approve:(\d+)/, async (ctx) => {
      const ok = await this.pipeline.approve(Number(ctx.match[1]));
      await ctx.answerCbQuery(ok ? 'Опубліковано' : 'Не вдалося');
    });

    this.bot.action(/reject:(\d+)/, async (ctx) => {
      const ok = this.pipeline.reject(Number(ctx.match[1]));
      await ctx.answerCbQuery(ok ? 'Відхилено' : 'Не вдалося');
    });

    this.bot.command('sources', (ctx) => {
      const rows = this.db.prepare('SELECT id,chat_id,username,title,trust_level,enabled FROM sources ORDER BY id DESC').all();
      if (!rows.length) return ctx.reply('Джерела відсутні.');
      return ctx.reply(rows.map((r) => `${r.id}. ${r.title || r.username || r.chat_id} [${r.enabled ? 'on' : 'off'}] level=${r.trust_level || 'B'}`).join('\n'));
    });

    this.bot.command('source_add', async (ctx) => {
      const input = ctx.message.text.split(' ').slice(1).join(' ').trim();
      if (!input) {
        this.pendingSourceInput.add(ctx.from.id);
        return ctx.reply('Надішліть @username або t.me посилання наступним повідомленням.');
      }
      await this.addSource(ctx, input);
    });

    this.bot.command('source_set_level', (ctx) => {
      const [, idRaw, levelRaw] = ctx.message.text.split(' ');
      const id = Number(idRaw || 0);
      const level = String(levelRaw || '').toUpperCase();
      if (!id || !['A', 'B', 'C'].includes(level)) return ctx.reply('Використання: /source_set_level <id> A|B|C');
      const changes = this.db.prepare('UPDATE sources SET trust_level=? WHERE id=?').run(level, id).changes;
      return ctx.reply(changes ? `Рівень оновлено: ${level}` : 'Не знайдено.');
    });

    this.bot.on('text', async (ctx, next) => {
      if (!this.pendingSourceInput.has(ctx.from.id)) return next();
      this.pendingSourceInput.delete(ctx.from.id);
      await this.addSource(ctx, ctx.message.text.trim());
    });

    this.bot.command('source_on', (ctx) => this.toggleSource(ctx, 1));
    this.bot.command('source_off', (ctx) => this.toggleSource(ctx, 0));

    this.bot.command('health', (ctx) => {
      const errors = this.db.prepare('SELECT COUNT(*) c FROM errors').get().c;
      const evh = this.db.prepare("SELECT COUNT(*) c FROM events WHERE datetime(created_at)>=datetime('now','-1 hour')").get().c;
      return ctx.reply(`Uptime: ${Math.floor(process.uptime())}s\nПодій/год: ${evh}\nПомилок: ${errors}`);
    });

    this.bot.command('settings', (ctx) => {
      const rows = this.db.prepare('SELECT key,value FROM settings ORDER BY key').all();
      return ctx.reply(rows.map((r) => `${r.key}=${r.value}`).join('\n'));
    });

    this.bot.command('set', (ctx) => {
      const [, key, ...rest] = ctx.message.text.split(' ');
      const value = rest.join(' ').trim();
      const keys = new Set(['dedup_window_min', 'confirm_count', 'cooldown_seconds', 'allow_a_alarms_in_manual', 'per_source_cooldown_sec', 'global_rate_max', 'global_rate_window_min']);
      if (!keys.has(key) || !value) return ctx.reply('Недозволений ключ або значення.');
      this.setSetting(key, value);
      return ctx.reply('Оновлено.');
    });
  }

  async addSource(ctx, input) {
    try {
      const r = await this.mtproto.resolveChannel(input);
      this.db.prepare('INSERT INTO sources(chat_id,username,title,trust_level,enabled) VALUES(?,?,?,?,1) ON CONFLICT(chat_id) DO UPDATE SET username=excluded.username,title=excluded.title,trust_level=COALESCE(sources.trust_level,\'B\')').run(r.chat_id, r.username, r.title, 'B');
      await ctx.reply(`Джерело додано: ${r.title} (${r.chat_id}), рівень B`);
    } catch (e) {
      const msg = String(e.message || 'невідома помилка');
      if (msg.startsWith('MTProto не підключено:')) return ctx.reply(msg);
      await ctx.reply(`Не вдалося додати джерело: ${msg}`);
    }
  }

  toggleSource(ctx, enabled) {
    const id = Number(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Вкажіть id');
    const changes = this.db.prepare('UPDATE sources SET enabled=? WHERE id=?').run(enabled, id).changes;
    return ctx.reply(changes ? 'Готово.' : 'Не знайдено.');
  }

  async launch() {
    this.install();
    await this.bot.launch();
  }
}
