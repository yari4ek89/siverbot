import fs from 'node:fs';
import path from 'node:path';

const defaultState = {
  lastMsgIdByChannel: {},
  dedup: {},
  eventDedup: {},
  eventBaseMeta: {},
  postingMode: 'auto',
  pendingQueue: {},
  nextPendingId: 1,
  llmMode: 'off',
  llmCooldownUntil: 0,
  llmLastError: null,
};

export class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = structuredClone(defaultState);
  }

  loadState() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.saveState();
        return this.state;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...defaultState,
        ...parsed,
        lastMsgIdByChannel: parsed.lastMsgIdByChannel || {},
        dedup: parsed.dedup || {},
        eventDedup: parsed.eventDedup || {},
        eventBaseMeta: parsed.eventBaseMeta || {},
        pendingQueue: parsed.pendingQueue || {},
      };
    } catch {
      this.state = structuredClone(defaultState);
      this.saveState();
    }
    return this.state;
  }

  saveState() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getLastMsgId(channel) {
    return this.state.lastMsgIdByChannel[channel] ?? 0;
  }

  setLastMsgId(channel, id) {
    this.state.lastMsgIdByChannel[channel] = id;
    this.saveState();
  }

  isDedup(key) {
    this.cleanupDedup();
    return Boolean(this.state.dedup[key]);
  }

  putDedup(key, ttlMin) {
    this.state.dedup[key] = Date.now() + ttlMin * 60 * 1000;
    this.saveState();
  }

  isEventDedup(eventKey) {
    this.cleanupDedup();
    return Boolean(this.state.eventDedup[eventKey]);
  }

  putEventDedup(eventKey, ttlMin) {
    this.state.eventDedup[eventKey] = Date.now() + ttlMin * 60 * 1000;
    this.saveState();
  }

  getEventBaseMeta(baseKey) {
    this.cleanupDedup();
    return this.state.eventBaseMeta[baseKey] || null;
  }

  putEventBaseMeta(baseKey, meta, ttlMin) {
    this.state.eventBaseMeta[baseKey] = {
      ...meta,
      expiresAt: Date.now() + ttlMin * 60 * 1000,
    };
    this.saveState();
  }

  cleanupDedup() {
    const now = Date.now();
    let changed = false;

    for (const [k, exp] of Object.entries(this.state.dedup)) {
      if (!exp || exp <= now) {
        delete this.state.dedup[k];
        changed = true;
      }
    }

    for (const [k, exp] of Object.entries(this.state.eventDedup)) {
      if (!exp || exp <= now) {
        delete this.state.eventDedup[k];
        changed = true;
      }
    }

    for (const [k, meta] of Object.entries(this.state.eventBaseMeta)) {
      if (!meta?.expiresAt || meta.expiresAt <= now) {
        delete this.state.eventBaseMeta[k];
        changed = true;
      }
    }

    if (changed) this.saveState();
  }

  getPostingMode() {
    const mode = this.state.postingMode;
    return ['auto', 'manual', 'off'].includes(mode) ? mode : 'auto';
  }

  setPostingMode(mode) {
    if (!['auto', 'manual', 'off'].includes(mode)) return false;
    this.state.postingMode = mode;
    this.saveState();
    return true;
  }

  getLlmMode() {
    const mode = this.state.llmMode;
    return ['off', 'smart'].includes(mode) ? mode : 'off';
  }

  setLlmMode(mode) {
    if (!['off', 'smart'].includes(mode)) return false;
    this.state.llmMode = mode;
    this.saveState();
    return true;
  }

  getLlmCooldownUntil() {
    return Number(this.state.llmCooldownUntil || 0);
  }

  setLlmCooldownUntil(ts) {
    this.state.llmCooldownUntil = Number(ts || 0);
    this.saveState();
  }

  getLlmLastError() {
    return this.state.llmLastError || null;
  }

  setLlmLastError(err) {
    this.state.llmLastError = err ? String(err) : null;
    this.saveState();
  }

  listPending() {
    return Object.values(this.state.pendingQueue);
  }

  getPending(id) {
    return this.state.pendingQueue[id] || null;
  }

  addPending(payload) {
    const id = String(this.state.nextPendingId++);
    this.state.pendingQueue[id] = {
      id,
      ...payload,
      createdAt: new Date().toISOString(),
    };
    this.saveState();
    return this.state.pendingQueue[id];
  }

  removePending(id) {
    const existing = this.state.pendingQueue[id] || null;
    if (existing) {
      delete this.state.pendingQueue[id];
      this.saveState();
    }
    return existing;
  }
}
