import fs from 'node:fs';
import path from 'node:path';

const defaultState = {
  lastMsgIdByChannel: {},
  dedup: {},
  eventBaseMeta: {},
  lastTickAt: null,
  lastTickError: 'none',
  lastPostedAt: null,
  lastPostError: 'none',
};

export class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = structuredClone(defaultState);
  }

  ensureDir() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  load() {
    this.ensureDir();
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.state = {
        ...structuredClone(defaultState),
        ...parsed,
        lastMsgIdByChannel: parsed.lastMsgIdByChannel || {},
        dedup: parsed.dedup || {},
        eventBaseMeta: parsed.eventBaseMeta || {},
      };
    } catch {
      this.state = structuredClone(defaultState);
      this.save();
    }
  }

  save() {
    this.ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getLastMsgId(channel) {
    return Number(this.state.lastMsgIdByChannel[channel] || 0);
  }

  setLastMsgId(channel, id) {
    this.state.lastMsgIdByChannel[channel] = Number(id || 0);
  }

  cleanupDedup(now = Date.now()) {
    for (const [k, exp] of Object.entries(this.state.dedup)) {
      if (!Number.isFinite(exp) || exp <= now) delete this.state.dedup[k];
    }
    for (const [k, meta] of Object.entries(this.state.eventBaseMeta)) {
      if (!meta?.expiresAtMs || meta.expiresAtMs <= now) delete this.state.eventBaseMeta[k];
    }
  }

  isDedup(key, now = Date.now()) {
    this.cleanupDedup(now);
    const exp = this.state.dedup[key];
    return Number.isFinite(exp) && exp > now;
  }

  putDedup(key, ttlSec) {
    this.state.dedup[key] = Date.now() + Math.max(1, Number(ttlSec || 1)) * 1000;
  }

  getBaseMeta(baseKey) {
    this.cleanupDedup();
    return this.state.eventBaseMeta[baseKey] || null;
  }

  setBaseMeta(baseKey, { locations, count }, ttlSec) {
    this.state.eventBaseMeta[baseKey] = {
      locations: locations || [],
      count: Number.isFinite(Number(count)) ? Number(count) : null,
      expiresAtMs: Date.now() + Math.max(1, Number(ttlSec || 1)) * 1000,
    };
  }

  setTickStatus({ at, error }) {
    this.state.lastTickAt = at;
    this.state.lastTickError = error || 'none';
  }

  setPostStatus({ at, error }) {
    this.state.lastPostedAt = at;
    this.state.lastPostError = error || 'none';
  }
}
