import fs from 'node:fs';
import path from 'node:path';

const defaultState = {
  lastMsgIdByChannel: {},
  dedup: {},
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

  cleanupDedup() {
    const now = Date.now();
    let changed = false;
    for (const [k, exp] of Object.entries(this.state.dedup)) {
      if (!exp || exp <= now) {
        delete this.state.dedup[k];
        changed = true;
      }
    }
    if (changed) this.saveState();
  }
}
