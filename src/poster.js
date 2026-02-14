import { sanitizeOutput } from './normalize.js';

const emojiByThreat = {
  uav: '🛸',
  missile: '🚀',
  aviation: '✈️',
  air_defense: '🛡️',
  unknown: '⚠️',
};

function regionLabel(regionHits = []) {
  const hits = new Set(regionHits);
  if (hits.has('both')) return 'Чернігівщина + Сумщина';
  if (hits.has('chernihiv') && hits.has('sumy')) return 'Чернігівщина + Сумщина';
  if (hits.has('chernihiv')) return 'Чернігівщина';
  if (hits.has('sumy')) return 'Сумщина';
  return 'Невідомо';
}

export async function postEvent({ bot, targetChatId, event }) {
  const { analysis } = event;
  const emoji = emojiByThreat[analysis.threatType] || emojiByThreat.unknown;

  const text = sanitizeOutput(`${emoji} ${analysis.title}\n${analysis.summary}\nРегіон: ${regionLabel(analysis.regionHits)}`);

  await bot.telegram.sendMessage(targetChatId, text, {
    disable_web_page_preview: true,
  });
}
