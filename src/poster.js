const emojiByThreat = {
  uav: '🛸',
  missile: '🚀',
  aviation: '✈️',
  air_defense: '🛡️',
  unknown: '⚠️',
};

function regionLabel(regionHits = []) {
  const hits = new Set(regionHits);
  if (hits.has('both')) return 'Обидва';
  if (hits.has('chernihiv') && hits.has('sumy')) return 'Обидва';
  if (hits.has('chernihiv')) return 'Чернігівщина';
  if (hits.has('sumy')) return 'Сумщина';
  return 'Невідомо';
}

export async function postEvent({ bot, targetChatId, event, testTag = '' }) {
  const { analysis, sources } = event;
  const emoji = emojiByThreat[analysis.threatType] || emojiByThreat.unknown;
  const title = `${testTag}${analysis.title}`.trim();

  const text = `${emoji} ${title}\n${analysis.summary}\nРегіон: ${regionLabel(analysis.regionHits)}\nДжерела: ${sources.join(', ')}`;

  await bot.telegram.sendMessage(targetChatId, text, {
    disable_web_page_preview: true,
  });
}
