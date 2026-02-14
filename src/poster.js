import { sanitizeOutput } from './normalize.js';

const emojiByThreat = {
  uav: '🛸',
  missile: '🚀',
  aviation: '✈️',
  air_defense: '🛡️',
  unknown: '⚠️',
};

function regionPhrase(region) {
  if (region === 'both') return 'Чернігівщині й Сумщині';
  if (region === 'chernihiv') return 'Чернігівщині';
  if (region === 'sumy') return 'Сумщині';
  return 'регіону';
}

function threatLine(threatType, region, isUpdate = false) {
  const rp = regionPhrase(region);
  const map = {
    uav: `Є БПЛА по ${rp}.`,
    missile: `Ракетна небезпека по ${rp}.`,
    aviation: `Авіаційна активність по ${rp}.`,
    air_defense: `Робота ППО по ${rp}.`,
    unknown: `Є повітряна загроза по ${rp}.`,
  };
  const base = map[threatType] || map.unknown;
  return isUpdate ? `Оновлення: ${base}` : base;
}

function locationsLine(locations = [], directions = []) {
  if (!locations.length) return 'Деталей по локаціях поки немає.';
  const items = locations.slice(0, 3).map((loc, idx) => {
    const dir = directions[idx];
    return dir ? `${loc} (${dir})` : loc;
  });
  return `Локації: ${items.join(', ')}.`;
}

export function buildPreviewText(analysis, opts = {}) {
  const threatType = analysis.threat_type || analysis.threatType || 'unknown';
  const region = analysis.regions || (analysis.regionHits?.[0] ?? 'none');
  const emoji = emojiByThreat[threatType] || emojiByThreat.unknown;
  const line1 = `${emoji} ${threatLine(threatType, region, opts.isUpdate || analysis.isUpdate)}`;
  const line2 = locationsLine(analysis.locations || [], analysis.directions || []);
  return sanitizeOutput(`${line1}\n${line2}`);
}

export async function postEvent({ bot, targetChatId, event, onSuccess, onError }) {
  const { analysis } = event;
  const text = buildPreviewText(analysis, { isUpdate: analysis.isUpdate });

  try {
    await bot.telegram.sendMessage(targetChatId, text, { disable_web_page_preview: true });
    if (typeof onSuccess === 'function') onSuccess();
  } catch (error) {
    const description = error?.response?.description || error?.description || error?.message || String(error);
    if (typeof onError === 'function') onError(description);
    throw error;
  }
}
