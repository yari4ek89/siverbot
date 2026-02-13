import { fetchActiveAlerts } from './alertsClient.js';

function normalizeRegionTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesRegion(regionTitle, regionTitles) {
  if (!regionTitles || regionTitles.size === 0) return true;

  const normalizedRegion = normalizeRegionTitle(regionTitle);
  for (const wantedRaw of regionTitles) {
    const wanted = normalizeRegionTitle(wantedRaw);
    if (!wanted) continue;

    if (normalizedRegion === wanted) return true;
    if (normalizedRegion.includes(wanted) || wanted.includes(normalizedRegion)) return true;
  }

  return false;
}

function toAlertKey(alertType, oblastUid, oblastTitle) {
  return `${alertType}|${oblastUid}|${oblastTitle}`;
}

function keyToOblast(key) {
  const parts = key.split('|');
  return parts[2] || '';
}

export class AlertsWatcher {
  constructor({ token, regionTitles = new Set() }) {
    this.token = token;
    this.regionTitles = regionTitles;
    this.prevActive = new Set();
    this.lastModified = null;
  }

  async tick() {
    const response = await fetchActiveAlerts({
      token: this.token,
      ifModifiedSince: this.lastModified
    });

    if (response.lastModified) {
      this.lastModified = response.lastModified;
    }

    if (response.status === 304) {
      return {
        started: [],
        ended: [],
        activeNow: [...this.prevActive].map(keyToOblast)
      };
    }

    const alerts = Array.isArray(response.data?.alerts) ? response.data.alerts : [];
    const current = new Set();

    for (const alert of alerts) {
      if (alert?.alert_type !== 'air_raid') continue;

      const oblastTitle = String(alert.location_oblast || alert.location_title || '').trim();
      const oblastUid = String(alert.location_oblast_uid || '').trim();
      if (!oblastTitle || !oblastUid) continue;

      if (!matchesRegion(oblastTitle, this.regionTitles)) continue;

      current.add(toAlertKey('air_raid', oblastUid, oblastTitle));
    }

    const started = [];
    const ended = [];

    for (const key of current) {
      if (!this.prevActive.has(key)) {
        started.push(keyToOblast(key));
      }
    }

    for (const key of this.prevActive) {
      if (!current.has(key)) {
        ended.push(keyToOblast(key));
      }
    }

    this.prevActive = current;

    return {
      started,
      ended,
      activeNow: [...current].map(keyToOblast)
    };
  }
}
