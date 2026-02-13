import fs from 'node:fs';
import config from '../config.js';
import { alertOn, alertOff } from '../pipeline/templates.js';

const STATE_FILE = 'state.json';
const DISTRICTS_FILE = 'districts.json';

export default class AlertsPoller {
  constructor({ onEvent, logger, getSetting }) {
    this.onEvent = onEvent;
    this.logger = logger;
    this.getSetting = getSetting;
    this.state = this.loadState();
    this.districts = JSON.parse(fs.readFileSync(DISTRICTS_FILE, 'utf-8')).map((x) => ({ uid: Number(x.uid), name: String(x.name || '').trim() })).filter((x) => Number.isFinite(x.uid) && x.name);
    this.timer = null;
  }

  loadState() {
    if (!fs.existsSync(STATE_FILE)) return { prev: {}, pending: {}, lastSentAt: {} };
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
    catch { return { prev: {}, pending: {}, lastSentAt: {} }; }
  }

  saveState() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  getCharByUid(bigString, uid) {
    const idx = uid + config.alerts.uidOffset;
    if (idx < 0 || idx >= bigString.length) return null;
    return bigString[idx];
  }

  isActive(ch) { return !!ch && config.alerts.activeSymbols.has(ch); }

  cooldownPassed(key) {
    const last = Number(this.state.lastSentAt[key] || 0);
    return (Date.now() - last) >= Number(this.getSetting('cooldown_seconds', String(config.alerts.cooldownSeconds))) * 1000;
  }

  markSent(keys) { const n = Date.now(); for (const k of keys) this.state.lastSentAt[k] = n; }

  async fetchBigString() {
    const headers = { Accept: '*/*' };
    headers[config.alerts.authHeader] = config.alerts.authHeader.toLowerCase() === 'authorization'
      ? `${config.alerts.authPrefix} ${config.alerts.token}`.trim()
      : config.alerts.token;

    const res = await fetch(config.alerts.url, { headers });
    if (!res.ok) throw new Error(`alerts api ${res.status}`);

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await res.json();
      if (typeof j === 'string') return j;
      for (const key of ['data', 'alerts', 'value', 'result']) if (typeof j?.[key] === 'string') return j[key];
      throw new Error('Unexpected JSON format from alerts api');
    }
    return res.text();
  }

  async tick() {
    try {
      const big = await this.fetchBigString();
      const on = [];
      const off = [];
      const confirmNeed = Number(this.getSetting('confirm_count', String(config.alerts.confirmCount)));

      for (const d of this.districts) {
        const k = String(d.uid);
        const current = this.isActive(this.getCharByUid(big, d.uid));
        const prev = this.state.prev[k];
        const pending = this.state.pending[k];

        if (typeof prev !== 'boolean') { this.state.prev[k] = current; this.state.pending[k] = undefined; continue; }
        if (current === prev) { this.state.pending[k] = undefined; continue; }

        if (!pending || pending.value !== current) { this.state.pending[k] = { value: current, count: 1 }; continue; }
        pending.count += 1;
        this.state.pending[k] = pending;
        if (pending.count < confirmNeed) continue;

        this.state.prev[k] = current;
        this.state.pending[k] = undefined;
        if (!this.cooldownPassed(k)) continue;
        if (current) on.push(d.name); else off.push(d.name);
        this.markSent([k]);
      }

      if (on.length) await this.onEvent({ source: 'alerts', source_ref: 'official_api', date: new Date().toISOString(), raw_text: alertOn(on), normalized_text: alertOn(on), category: 'official_notice' });
      if (off.length) await this.onEvent({ source: 'alerts', source_ref: 'official_api', date: new Date().toISOString(), raw_text: alertOff(off), normalized_text: alertOff(off), category: 'official_notice' });
      this.saveState();
    } catch (e) {
      this.logger.error({ err: e.message }, 'Tick error');
    }
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), config.alerts.pollSeconds * 1000);
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}
