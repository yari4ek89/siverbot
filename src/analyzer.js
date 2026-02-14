import { analyzeWithGemini } from './llmGemini.js';

const threatKeywords = ['бпла', 'дрон', 'shahed', 'шахед', 'ракета', 'баллист', 'крылат', 'авиа', 'пуск', 'пво', 'зрк'];
const regionKeywords = ['черніг', 'черниг', 'чернігів', 'чернигов', 'сум', 'сумы', 'сумська', 'сіверщина', 'северщина'];

function fallback(text) {
  const lower = text.toLowerCase();
  const hasThreat = threatKeywords.some((k) => lower.includes(k));
  const hasRegion = regionKeywords.some((k) => lower.includes(k));

  return {
    shouldPost: hasThreat && hasRegion,
    regionHits: hasRegion ? ['both'] : ['none'],
    threatType: hasThreat ? 'unknown' : 'unknown',
    confidence: hasThreat && hasRegion ? 0.45 : 0.1,
    title: hasThreat && hasRegion ? 'Повідомлення про можливу повітряну загрозу' : 'Нерелевантно',
    summary: hasThreat && hasRegion
      ? 'Зафіксовано повідомлення з відкритих джерел про повітряну небезпеку у регіоні.'
      : 'Повідомлення не відповідає фільтру повітряної небезпеки для Чернігівщини/Сумщини.',
    reason: hasThreat && hasRegion ? 'Fallback: threat+region keywords matched' : 'Fallback: insufficient keyword evidence',
    language: 'uk',
  };
}

export async function analyzeMessage({ text, sourceName, regions, config, logger }) {
  const prompt = `You are an OSINT safety classifier. Return STRICT JSON only with schema:
{
  "should_post": boolean,
  "regions": ["chernihiv"|"sumy"|"both"|"none"],
  "threat_type": "uav"|"missile"|"aviation"|"air_defense"|"unknown",
  "confidence": number,
  "title": string,
  "summary": string,
  "reason": string
}
Rules:
- Post only for air danger context: UAV/missile/aviation/air defense.
- Must concern Chernihiv and/or Sumy regions.
- Never provide coordinates, flight direction, destination, or forecasts.
- If uncertain, set should_post=false.
- Keep summary factual, 1-2 sentences.
Input source: ${sourceName}
Allowed regions config: ${regions.join(',')}
Message:\n${text}`;

  try {
    const parsed = await analyzeWithGemini({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      text: prompt,
      timeoutMs: config.llmTimeoutMs,
      logger,
    });

    return {
      shouldPost: Boolean(parsed.should_post),
      regionHits: Array.isArray(parsed.regions) ? parsed.regions : ['none'],
      threatType: parsed.threat_type || 'unknown',
      confidence: Number(parsed.confidence ?? 0),
      title: parsed.title || 'Повідомлення',
      summary: parsed.summary || '',
      reason: parsed.reason || '',
      language: 'uk',
    };
  } catch {
    return fallback(text);
  }
}
