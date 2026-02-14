import { sanitizeOutput } from './extractors.mjs';

function regionPhrase(region) {
  if (region === 'chernihiv') return 'Чернігівщині';
  if (region === 'sumy') return 'Сумщині';
  if (region === 'both') return 'Чернігівщині й Сумщині';
  return 'регіону';
}

function line1(threat, regions, isUpdate = false) {
  const rp = regionPhrase(regions);
  let base = '⚠️ Є повітряна загроза.';
  if (threat === 'uav') base = `🛸 Є БПЛА по ${rp}.`;
  if (threat === 'missile') base = `🚀 Ракетна небезпека по ${rp}.`;
  if (threat === 'ppo') base = `🛡️ Робота ППО по ${rp}.`;
  if (threat === 'aviation') base = `✈️ Авіаційна активність по ${rp}.`;
  if (!isUpdate) return base;
  return base.replace(/^([🛸🚀🛡️✈️⚠️])\s+/, '$1 Оновлення: ');
}

function line2(locations = [], directions = []) {
  if (!locations.length) return 'Деталей по локаціях поки немає.';
  const parts = locations.slice(0, 3).map((loc, i) => {
    const dir = directions[i];
    return dir ? `${loc} (${dir})` : loc;
  });
  return `Локації: ${parts.join(', ')}.`;
}

export function buildPostText(analysis, { isUpdate = false } = {}) {
  const text = `${line1(analysis.threat_type, analysis.regions, isUpdate)}\n${line2(analysis.locations, analysis.directions)}`;
  return sanitizeOutput(text);
}
