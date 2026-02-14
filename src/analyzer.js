import { analyzeWithGemini, getLlmStatus } from './llmGemini.js';
import { normalizeText } from './normalize.js';

const KEYWORDS = {
  uav: ['бпла', 'бплa', 'дрон', 'дрони', 'шахед', 'shahed', 'мопед', 'герань', 'герaнь'],
  missile: ['ракета', 'ракетна', 'ракетн', 'ракетна небезпека', 'крилата', 'крылат', 'баллист', 'баліст', 'пуск', 'зліт', 'злет'],
  aviation: ['авіа', 'авиа', 'літак', 'самолёт', 'стратегічна', 'стратегическая', 'тушка', 'ту-', 'міг', 'mig', 'су-'],
  air_defense: ['пво', 'ппо', 'зрк', 'с-300', 'с-400', 'патриот', 'patriot'],
};

const CHERNIHIV_PATTERNS = ['черніг', 'черниг', 'чернігівщ', 'черниговск', 'ніжин', 'нежин', 'прилук', 'бахмач', 'корюків', 'новгород-сівер', 'сіверщина'];
const SUMY_PATTERNS = ['сум', 'сумщ', 'сумська', 'суми', 'конотоп', 'шостк', 'охтирк', 'глухів', 'ромн'];

function shortError(message, limit = 200) {
  if (!message) return 'unknown';
  return String(message).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function detectRegions(textNorm) {
  const hitsC = CHERNIHIV_PATTERNS.some((p) => textNorm.includes(p));
  const hitsS = SUMY_PATTERNS.some((p) => textNorm.includes(p));

  if (hitsC && hitsS) return ['both'];
  if (hitsC) return ['chernihiv'];
  if (hitsS) return ['sumy'];
  return ['none'];
}

function detectThreatType(textNorm) {
  if (KEYWORDS.uav.some((k) => textNorm.includes(k))) return 'uav';
  if (KEYWORDS.missile.some((k) => textNorm.includes(k))) return 'missile';
  if (KEYWORDS.aviation.some((k) => textNorm.includes(k))) return 'aviation';
  if (KEYWORDS.air_defense.some((k) => textNorm.includes(k))) return 'air_defense';
  return 'unknown';
}

function regionLabel(regionHits) {
  if (regionHits.includes('both')) return 'Чернігівщина + Сумщина';
  if (regionHits.includes('chernihiv')) return 'Чернігівщина';
  if (regionHits.includes('sumy')) return 'Сумщина';
  return 'Регіон не визначено';
}

function titleByThreat(threatType, regionHits) {
  const region = regionLabel(regionHits);
  const map = {
    uav: `БПЛА: ${region}`,
    missile: `Ракетна небезпека: ${region}`,
    aviation: `Авіаційна активність: ${region}`,
    air_defense: `Активність ППО: ${region}`,
    unknown: `Повітряна загроза: ${region}`,
  };
  return map[threatType] || map.unknown;
}

function summaryByThreat(threatType, regionHits) {
  const region = regionLabel(regionHits);
  const map = {
    uav: `За повідомленнями моніторингових каналів, зафіксовано повітряну загрозу із застосуванням БПЛА у межах регіону ${region}. Інформація подана як факт публікації без прогнозів і маршрутів.`,
    missile: `За повідомленнями моніторингових каналів, оприлюднено факт ракетної небезпеки для регіону ${region}. Публікація містить лише коротку безпечну сводку без координат і напрямків.`,
    aviation: `За повідомленнями моніторингових каналів, є ознаки авіаційної загрози для регіону ${region}. Подано стислу фактологічну інформацію без прогнозів.`,
    air_defense: `За повідомленнями моніторингових каналів, згадується повітряна небезпека в контексті роботи ППО у регіоні ${region}. Публікація не містить координат і напрямків.`,
    unknown: `Зафіксовано повідомлення про повітряну небезпеку для регіону ${region}. Подано лише факт публікації з відкритих джерел.`,
  };
  return map[threatType] || map.unknown;
}

function fallback(text, llmError = null) {
  const textNorm = normalizeText(text);
  const regionHits = detectRegions(textNorm);
  const threatType = detectThreatType(textNorm);
  const shouldPost = threatType !== 'unknown' && !regionHits.includes('none');

  return {
    shouldPost,
    regionHits,
    threatType,
    confidence: shouldPost ? 0.5 : 0.1,
    title: titleByThreat(threatType, regionHits),
    summary: shouldPost
      ? summaryByThreat(threatType, regionHits)
      : 'Повідомлення не відповідає фільтру повітряної небезпеки для Чернігівщини/Сумщини.',
    reason: `LLM error: ${shortError(llmError || 'unavailable')}`,
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
- If message mentions only one region, set regions to that single region (sumy or chernihiv), not both.
- Never provide coordinates, flight direction, destination, strike timing, or forecasts.
- Keep summary factual in 1-2 sentences and safe.
- If uncertain, set should_post=false.
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

    const regionHits = Array.isArray(parsed.regions) && parsed.regions.length ? parsed.regions : ['none'];
    const threatType = parsed.threat_type || 'unknown';
    const shouldPost = Boolean(parsed.should_post) && threatType !== 'unknown' && !regionHits.includes('none');

    return {
      shouldPost,
      regionHits,
      threatType,
      confidence: Number(parsed.confidence ?? 0),
      title: parsed.title || titleByThreat(threatType, regionHits),
      summary: parsed.summary || summaryByThreat(threatType, regionHits),
      reason: parsed.reason || 'LLM classification',
      language: 'uk',
    };
  } catch (error) {
    const llm = getLlmStatus();
    const modelInfo = llm.lastTriedModel ? ` (model=${llm.lastTriedModel})` : '';
    return fallback(text, `${error?.message || 'unknown'}${modelInfo}`);
  }
}
