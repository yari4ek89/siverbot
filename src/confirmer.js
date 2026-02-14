import { normalizeText } from './normalize.js';
import { isDayTime } from './timeWindow.js';

export class Confirmer {
  constructor({ confirmWindowMin, minSourcesDay, minSourcesNight, dayStart, dayEnd }) {
    this.confirmWindowMs = confirmWindowMin * 60 * 1000;
    this.minSourcesDay = minSourcesDay;
    this.minSourcesNight = minSourcesNight;
    this.dayStart = dayStart;
    this.dayEnd = dayEnd;
    this.buffer = new Map();
  }

  add({ text, sourceName, analysis }) {
    const now = Date.now();
    const key = normalizeText(text).slice(0, 220);
    const threshold = isDayTime(new Date(now), this.dayStart, this.dayEnd) ? this.minSourcesDay : this.minSourcesNight;

    this.cleanup(now);

    const existing = this.buffer.get(key) || {
      createdAt: now,
      expiresAt: now + this.confirmWindowMs,
      sources: new Set(),
      analysis,
      text,
    };

    existing.sources.add(sourceName);
    if ((analysis?.confidence ?? 0) > (existing.analysis?.confidence ?? 0)) {
      existing.analysis = analysis;
    }
    this.buffer.set(key, existing);

    if (existing.sources.size >= threshold) {
      this.buffer.delete(key);
      return {
        readyToPost: true,
        key,
        sources: [...existing.sources],
        analysis: existing.analysis,
        text: existing.text,
      };
    }

    return { readyToPost: false, key, sources: [...existing.sources] };
  }

  cleanup(now = Date.now()) {
    for (const [key, value] of this.buffer.entries()) {
      if (value.expiresAt <= now) this.buffer.delete(key);
    }
  }
}
