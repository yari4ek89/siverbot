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

function humanThreatLine(threatType, region) {
  const rp = regionPhrase(region);
  const map = {
    uav: `Є БПЛА по ${rp}.`,
    missile: `Ракетна небезпека по ${rp}.`,
    aviation: `Авіаційна активність по ${rp}.`,
    air_defense: `Робота ППО по ${rp}.`,
    unknown: `Є повітряна загроза по ${rp}.`,
  };
  return map[threatType] || map.unknown;
}

function locationsLine(locations = [], directions = []) {
  if (!locations.length) return 'Деталей по локаціях поки немає.';

  const items = locations.slice(0, 3).map((loc, idx) => {
    const dir = directions[idx];
    if (!dir) return loc;
    return `${loc} (${dir})`;
  });

  return `Локації: ${items.join(', ')}.`;
}

export function buildPreviewText(analysis) {
  const emoji = emojiByThreat[analysis.threat_type || analysis.threatType] || emojiByThreat.unknown;
  const threatType = analysis.threat_type || analysis.threatType || 'unknown';
  const region = analysis.regions || (analysis.regionHits?.[0] ?? 'none');

  const line1 = `${emoji} ${humanThreatLine(threatType, region)}`;
  const line2 = locationsLine(analysis.locations || [], analysis.directions || []);

  return sanitizeOutput(`${line1}\n${line2}`);
}

export async function postEvent({ bot, targetChatId, event }) {
  const { analysis } = event;
  const text = buildPreviewText(analysis);

  await bot.telegram.sendMessage(targetChatId, text, {
    disable_web_page_preview: true,
  });
}
