import config from '../config.js';
import { analyzeWithLLM } from './llm.js';
import { hasUnsafe, redactUnsafe } from './safety.js';
import { signatureFor, isDuplicate } from './dedup.js';
import { unverified } from './templates.js';

export default class Pipeline {
  constructor({ db, getSetting, bot, logger }) {
    this.db = db;
    this.getSetting = getSetting;
    this.bot = bot;
    this.logger = logger;
  }

  dutyEnabled() { return this.getSetting('duty_enabled', 'false') === 'true'; }
  mode() { return (this.getSetting('mode', 'manual') || 'manual').toLowerCase(); }

  async ingest(input) {
    const normalized = input.normalized_text || input.raw_text || '';
    const hardUnsafe = hasUnsafe(normalized);
    const llm = input.source === 'alerts'
      ? { category: input.category, safe: !hardUnsafe, confidence: 100, short_ua: normalized, reasons: [] }
      : await analyzeWithLLM(normalized, this.logger);

    const event = {
      ...input,
      normalized_text: normalized,
      llm_short: llm.short_ua,
      category: llm.category || input.category || 'other',
      confidence: llm.confidence,
      safety_flag: hardUnsafe || !llm.safe ? 1 : 0,
    };

    const eventId = this.db.prepare(`
      INSERT INTO events(source,source_id,msg_id,source_ref,date,raw_text,normalized_text,llm_short,category,confidence,safety_flag)
      VALUES(@source,@source_id,@msg_id,@source_ref,@date,@raw_text,@normalized_text,@llm_short,@category,@confidence,@safety_flag)
    `).run(event).lastInsertRowid;

    const sig = signatureFor(event);
    const windowMin = Number(this.getSetting('dedup_window_min', String(config.app.dedupWindowMin)));
    if (isDuplicate(this.db, sig, windowMin)) return { status: 'duplicate', eventId };

    const decision = this.decide(event);
    if (decision.publish) {
      const text = await this.buildPublishMessage(event);
      if (!text) return this.enqueue(eventId, decision.reason || 'policy');
      const sent = await this.bot.telegram.sendMessage(this.bot.channel, text);
      this.db.prepare('INSERT INTO published(signature,posted_at,channel_message_id) VALUES(?,?,?)').run(sig, new Date().toISOString(), String(sent.message_id));
      return { status: 'published', eventId };
    }

    if (decision.drop) return { status: 'dropped', eventId };
    return this.enqueue(eventId, decision.reason || 'policy');
  }

  decide(event) {
    if (event.safety_flag) return { publish: false, reason: 'safety' };
    if (!this.dutyEnabled()) return { publish: false, reason: 'duty_off' };

    const mode = this.mode();
    if (event.source === 'alerts') {
      if (mode === 'manual' && this.getSetting('allow_a_alarms_in_manual', 'false') !== 'true') return { publish: false, reason: 'manual' };
      return { publish: true };
    }

    if (mode === 'manual') return { publish: false, reason: 'manual' };
    if (mode === 'night') return { publish: false, reason: 'night_mtproto_queue' };

    const allow = this.getSetting('autopost_unverified_day', 'false') === 'true';
    if (!allow) return { publish: false, reason: 'unverified_disabled' };

    const sources = this.findIndependentSources(event.normalized_text);
    if (sources.length < 2) return { publish: false, reason: 'need_2_sources' };
    return { publish: true };
  }

  findIndependentSources(text) {
    const rows = this.db.prepare(`
      SELECT DISTINCT source_ref FROM events
      WHERE source='mtproto' AND safety_flag=0
        AND datetime(created_at)>=datetime('now','-10 minutes')
        AND normalized_text=?
    `).all(text);
    return rows.map((r) => r.source_ref).filter(Boolean);
  }

  async buildPublishMessage(event) {
    if (event.source === 'alerts') return event.normalized_text;
    const refs = this.findIndependentSources(event.normalized_text);
    if (refs.length < 2) return null;
    const rows = this.db.prepare('SELECT chat_id, COALESCE(username,title,chat_id) name FROM sources WHERE chat_id IN (?,?)').all(refs[0], refs[1]);
    const hhmm = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    return unverified(rows[0]?.name || refs[0], rows[1]?.name || refs[1], hhmm);
  }

  enqueue(eventId, reason) {
    this.db.prepare('INSERT INTO queue(event_id,reason,status) VALUES(?,?,?)').run(eventId, reason, 'pending');
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
}
