import config from '../config.js';
import { analyzeWithLLM } from './llm.js';
import { hasUnsafe, redactUnsafe } from './safety.js';
import { signatureFor, isDuplicate } from './dedup.js';

const SHAHED_RE = /\b(шахед|shahed|бпла|дрон|uav|мопед)\b/iu;

export default class Pipeline {
  constructor({ db, getSetting, setSetting, bot, logger }) {
    this.db = db;
    this.getSetting = getSetting;
    this.setSetting = setSetting;
    this.bot = bot;
    this.logger = logger;
  }

  dutyEnabled() { return this.getSetting('duty_enabled', 'false') === 'true'; }
  mode() { return (this.getSetting('mode', 'manual') || 'manual').toLowerCase(); }
  focusMode() { return (this.getSetting('focus_mode', config.app.focusMode) || 'shahed').toLowerCase(); }

  isTrusted(event) {
    if (event.source === 'alerts') return true;
    const level = String(event.trust_level || 'B').toUpperCase();
    return level === 'A' || level === 'B' || level === 'TRUSTED';
  }

  async ingest(input) {
    const normalized = input.normalized_text || input.raw_text || '';
    const focus = this.focusMode();

    if (input.source === 'mtproto' && focus === 'shahed' && !SHAHED_RE.test(normalized)) {
      return { status: 'dropped_focus' };
    }

    const hardUnsafe = hasUnsafe(normalized);
    const llm = input.source === 'alerts'
      ? { category: input.category || 'official_notice', safe: !hardUnsafe, confidence: 100, short_ua: normalized }
      : await analyzeWithLLM(normalized, this.logger);

    const event = {
      ...input,
      normalized_text: normalized,
      category: input.source === 'mtproto' && focus === 'shahed' ? 'uav_shahed' : (llm.category || input.category || 'other'),
      llm_short: llm.short_ua,
      confidence: llm.confidence || 0,
      safety_flag: hardUnsafe || !llm.safe ? 1 : 0,
    };

    const eventId = this.db.prepare(`
      INSERT INTO events(source,source_id,source_name,trust_level,msg_id,source_ref,date,raw_text,normalized_text,llm_short,category,confidence,safety_flag)
      VALUES(@source,@source_id,@source_name,@trust_level,@msg_id,@source_ref,@date,@raw_text,@normalized_text,@llm_short,@category,@confidence,@safety_flag)
    `).run(event).lastInsertRowid;

    if (event.safety_flag) {
      return this.enqueue(eventId, 'safety', redactUnsafe(event.normalized_text).slice(0, 300));
    }

    const sig = signatureFor(event);
    const dedupWindow = Number(this.getSetting('dedup_window_min', String(config.app.dedupWindowMin)));
    if (isDuplicate(this.db, sig, dedupWindow)) {
      this.bumpCluster(sig);
      return { status: 'duplicate', eventId };
    }

    const decision = this.decide(event);
    if (!decision.publish) {
      if (decision.drop) return { status: 'dropped', eventId };
      return this.enqueue(eventId, decision.reason || 'policy', redactUnsafe(event.llm_short || event.normalized_text).slice(0, 300));
    }

    const spam = await this.passAntiSpam(event);
    if (!spam.ok) {
      this.bumpCluster(sig);
      if (spam.reason === 'global_rate_exceeded') await this.maybeSendDigest();
      return { status: 'suppressed', eventId };
    }

    const text = this.buildPublishMessage(event);
    if (!text) return this.enqueue(eventId, 'cannot_summarize_safe', redactUnsafe(event.normalized_text).slice(0, 300));

    const sent = await this.bot.telegram.sendMessage(this.bot.channel, text);
    this.db.prepare('INSERT INTO published(signature,source_ref,posted_at,channel_message_id) VALUES(?,?,?,?)').run(sig, event.source_ref || event.source, new Date().toISOString(), String(sent.message_id));
    return { status: 'published', eventId };
  }

  decide(event) {
    if (!this.dutyEnabled()) return { publish: false, reason: 'duty_off' };
    const mode = this.mode();
    if (mode === 'manual') return { publish: false, reason: 'manual' };
    if (!this.isTrusted(event)) return { publish: false, reason: 'untrusted' };
    return { publish: true };
  }

  async passAntiSpam(event) {
    const sourceCd = Number(this.getSetting('per_source_cooldown_sec', String(config.app.perSourceCooldownSec)));
    const lastFromSource = this.db.prepare(`
      SELECT id FROM published
      WHERE source_ref=? AND datetime(created_at)>=datetime('now', ?)
      LIMIT 1
    `).get(event.source_ref || event.source, `-${sourceCd} seconds`);
    if (lastFromSource) {
      this.setSetting('last_suppressed_count', Number(this.getSetting('last_suppressed_count', '0')) + 1);
      return { ok: false, reason: 'source_cooldown' };
    }

    const maxPosts = Number(this.getSetting('global_rate_max', String(config.app.globalRateMax)));
    const windowMin = Number(this.getSetting('global_rate_window_min', String(config.app.globalRateWindowMin)));
    const globalCount = this.db.prepare(`SELECT COUNT(*) c FROM published WHERE datetime(created_at)>=datetime('now', ?)`).get(`-${windowMin} minutes`).c;
    if (globalCount >= maxPosts) {
      this.setSetting('last_suppressed_count', Number(this.getSetting('last_suppressed_count', '0')) + 1);
      return { ok: false, reason: 'global_rate_exceeded' };
    }

    return { ok: true };
  }


  async maybeSendDigest() {
    const now = Date.now();
    const intervalMin = Number(this.getSetting('digest_interval_min', String(config.app.digestIntervalMin)));
    const last = Number(this.getSetting('digest_last_posted_at', '0'));
    if (now - last < intervalMin * 60 * 1000) return;

    const count = Number(this.getSetting('last_suppressed_count', '0'));
    if (!count) return;

    await this.bot.telegram.sendMessage(this.bot.channel, `🧩 Оновлення: +${count} схожих повідомлень за останні 10 хв.`);
    this.setSetting('digest_last_posted_at', String(now));
    this.setSetting('last_suppressed_count', '0');
  }

  bumpCluster(signature) {
    const row = this.db.prepare('SELECT count FROM clusters WHERE signature=?').get(signature);
    if (row) {
      const next = Number(row.count) + 1;
      this.db.prepare('UPDATE clusters SET count=?, updated_at=CURRENT_TIMESTAMP WHERE signature=?').run(next, signature);
      this.setSetting('last_suppressed_count', next);
    } else {
      this.db.prepare('INSERT INTO clusters(signature,count) VALUES(?,?)').run(signature, 1);
      this.setSetting('last_suppressed_count', 1);
    }
  }

  buildPublishMessage(event) {
    if (event.source === 'alerts') return event.normalized_text;

    if (event.category === 'uav_shahed') {
      const hhmm = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
      return `⚠️ Повідомлення про БпЛА (неофіційні деталі без уточнення місця).\nДжерело: ${event.source_name || event.source_ref}\nЧас: ${hhmm}`;
    }

    const hhmm = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    const safeShort = redactUnsafe(event.llm_short || event.normalized_text).slice(0, 240);
    return `${safeShort}\nДжерело: ${event.source_name || event.source_ref}\nЧас: ${hhmm}`;
  }

  enqueue(eventId, reason, preview = '') {
    this.db.prepare('INSERT INTO queue(event_id,reason,status,preview_redacted) VALUES(?,?,?,?)').run(eventId, reason, 'pending', preview);
    return { status: 'queued', eventId };
  }

  async approve(queueId) {
    const row = this.db.prepare(`SELECT q.status,e.source,e.normalized_text,e.llm_short FROM queue q JOIN events e ON e.id=q.event_id WHERE q.id=?`).get(queueId);
    if (!row || row.status !== 'pending') return false;
    const text = row.source === 'alerts' ? row.normalized_text : `ℹ️ ${redactUnsafe(row.llm_short || row.normalized_text).slice(0, 280)}`;
    await this.bot.telegram.sendMessage(this.bot.channel, text);
    this.db.prepare("UPDATE queue SET status='approved', decided_at=CURRENT_TIMESTAMP WHERE id=?").run(queueId);
    return true;
  }

  reject(queueId) {
    return this.db.prepare("UPDATE queue SET status='rejected', decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(queueId).changes > 0;
  }

  antiSpamStatus() {
    return {
      dedupWindowMin: this.getSetting('dedup_window_min', String(config.app.dedupWindowMin)),
      perSourceCooldownSec: this.getSetting('per_source_cooldown_sec', String(config.app.perSourceCooldownSec)),
      globalRateMax: this.getSetting('global_rate_max', String(config.app.globalRateMax)),
      globalRateWindowMin: this.getSetting('global_rate_window_min', String(config.app.globalRateWindowMin)),
      lastSuppressed: this.getSetting('last_suppressed_count', '0'),
    };
  }
}
