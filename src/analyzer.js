import { analyzeWithGemini, getLlmStatus } from './llmGemini.js';
import { normalizeText, sanitizeOutput } from './normalize.js';
import { getSourceProfile } from './sourceProfile.js';

const KEYWORDS = {
  uav: ['бпла', 'бплa', 'дрон', 'дрони', 'шахед', 'shahed', 'мопед', 'герань', 'герaнь'],
  missile: ['ракета', 'ракетна', 'ракетн', 'ракетна небезпека', 'крилата', 'крылат', 'баллист', 'баліст', 'пуск', 'зліт', 'злет'],
  aviation: ['авіа', 'авиа', 'літак', 'самолёт', 'стратегічна', 'стратегическая', 'тушка', 'ту-', 'міг', 'mig', 'су-'],
  air_defense: ['пво', 'ппо', 'зрк', 'с-300', 'с-400', 'патриот', 'patriot'],
};

const CHERNIHIV_PATTERNS = ['черніг', 'черниг', 'чернігівщ', 'черниговск', 'ніжин', 'нежин', 'прилук', 'бахмач', 'корюків', 'новгород сівер', 'новгород-сівер', 'сіверщина'];
const SUMY_PATTERNS = ['сум', 'сумщ', 'сумська', 'суми', 'конотоп', 'шостк', 'охтирк', 'глухів', 'ромн'];

const KNOWN_LOCATIONS = [
  'вакалівщина', 'вакаливщина', 'vakalyvshchyna', 'vakalivshchyna',
  'ніжин', 'нежин', 'прилуки', 'прилук', 'бахмач', 'корюківка', 'корюків', 'новгород-сіверський', 'новгород сівер',
  'суми', 'сумська область', 'конотоп', 'шостка', 'охтирка', 'глухів', 'ромни', 'путивль', 'тростянець',
  'чернігів', 'чернігівщина', 'чернигов',
];

function shortError(message, limit = 200) {
  if (!message) return 'невідома помилка';
  return sanitizeOutput(String(message).replace(/\s+/g, ' ').trim().slice(0, limit));
}

function detectRegions(textNorm) {
  const hitsC = CHERNIHIV_PATTERNS.some((p) => textNorm.includes(p));
  const hitsS = SUMY_PATTERNS.some((p) => textNorm.includes(p)) || textNorm.includes('вакалівщина') || textNorm.includes('вакаливщина') || textNorm.includes('vakalyvshchyna') || textNorm.includes('vakalivshchyna');

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
    aviation: `Авіаційна загроза: ${region}`,
    air_defense: `Повітряна небезпека: ${region}`,
    unknown: `Повітряна загроза: ${region}`,
  };
  return sanitizeOutput(map[threatType] || map.unknown);
}

function extractDirectionPhrases(text) {
  const out = [];
  const patterns = [
    /\bв\s+бік\s+[\p{L}\p{N}\-\s]{2,40}/giu,
    /\bкурс\s+на\s+[\p{L}\p{N}\-\s]{2,40}/giu,
    /\bнапрямок\s+[\p{L}\p{N}\-\s]{2,40}/giu,
  ];

  for (const re of patterns) {
    const matches = text.match(re) || [];
    for (const m of matches) {
      const clean = sanitizeOutput(m).slice(0, 60).trim();
      if (clean && !out.includes(clean)) out.push(clean);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

function extractLocations(textNorm) {
  const found = [];
  for (const loc of KNOWN_LOCATIONS) {
    if (textNorm.includes(loc) && !found.includes(loc)) found.push(loc);
    if (found.length >= 3) break;
  }
  return found;
}

function buildFallbackSummary({ threatType, locations, directions, regionHits }) {
  const threatLabel = {
    uav: 'БПЛА',
    missile: 'ракетну небезпеку',
    aviation: 'авіаційну загрозу',
    air_defense: 'повітряну небезпеку',
    unknown: 'повітряну небезпеку',
  }[threatType] || 'повітряну небезпеку';

  const locText = locations.length ? ` Локації з повідомлення: ${locations.join(', ')}.` : '';
  const dirText = directions.length ? ` Напрямки вказані у тексті: ${directions.join('; ')}.` : '';

  return sanitizeOutput(`Зафіксовано повідомлення про ${threatLabel} у межах регіону ${regionLabel(regionHits)}.${locText}${dirText}`);
}

function fallback({ text, sourceName, config, llmError = null }) {
  const textNorm = normalizeText(text);
  const regionHits = detectRegions(textNorm);
  let threatType = detectThreatType(textNorm);
  const profile = getSourceProfile(sourceName, config);
  const locations = extractLocations(textNorm);
  const directions = extractDirectionPhrases(text);

  if (threatType === 'unknown' && profile.allowLocationOnly && !regionHits.includes('none')) {
    threatType = profile.defaultThreatType;
  }

  const shouldPost = !regionHits.includes('none') && ['uav', 'missile', 'aviation', 'air_defense'].includes(threatType);

  const reason = shouldPost && profile.allowLocationOnly && detectThreatType(textNorm) === 'unknown'
    ? 'Локація з профільного радара інтерпретована як повітряна загроза.'
    : `LLM error: ${shortError(llmError || 'недоступний')}`;

  return {
    shouldPost,
    regionHits,
    threatType: shouldPost ? threatType : 'unknown',
    confidence: shouldPost ? (profile.allowLocationOnly && detectThreatType(textNorm) === 'unknown' ? 0.65 : 0.5) : 0.1,
    title: titleByThreat(shouldPost ? threatType : 'unknown', regionHits),
    summary: shouldPost
      ? buildFallbackSummary({ threatType, locations, directions, regionHits })
      : 'Повідомлення не відповідає фільтру повітряної небезпеки для Чернігівщини/Сумщини.',
    reason: sanitizeOutput(reason),
    language: 'uk',
  };
}

export async function analyzeMessage({ text, sourceName, regions, config, logger }) {
  const profile = getSourceProfile(sourceName, config);
  const prompt = `Ти класифікатор OSINT-повідомлень про повітряні загрози. Поверни СУВОРО JSON за схемою:
{
  "should_post": boolean,
  "regions": ["chernihiv"|"sumy"|"both"|"none"],
  "threat_type": "uav"|"missile"|"aviation"|"air_defense"|"unknown",
  "confidence": number,
  "title": string,
  "summary": string,
  "reason": string
}
Правила:
- Пиши українською.
- Публікувати лише повітряні загрози для Чернігівщини та/або Сумщини.
- Якщо згадана лише одна область, вкажи тільки її, не "both".
- НЕ згадуй джерела/канали/@юзернейми.
- Локації/напрямки можна згадувати ТІЛЬКИ якщо вони є в оригінальному тексті. Не додавати нічого від себе.
- Джерело: ${sourceName}. Профіль: defaultThreatType=${profile.defaultThreatType}, allowLocationOnly=${profile.allowLocationOnly}.
- Якщо джерело не профільне, не припускай загрозу лише по локації.
- Заборонено координати, цілі, прогнози часу/ударів.
- Якщо невпевнено, should_post=false.
Текст повідомлення:\n${text}`;

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
    const shouldPost = !regionHits.includes('none') && ['uav', 'missile', 'aviation', 'air_defense'].includes(threatType);

    return {
      shouldPost,
      regionHits,
      threatType: shouldPost ? threatType : 'unknown',
      confidence: Number(parsed.confidence ?? 0),
      title: sanitizeOutput(parsed.title || titleByThreat(threatType, regionHits)),
      summary: sanitizeOutput(parsed.summary || buildFallbackSummary({ threatType, locations: [], directions: [], regionHits })),
      reason: sanitizeOutput(parsed.reason || 'Класифікація виконана LLM'),
      language: 'uk',
    };
  } catch (error) {
    const llm = getLlmStatus();
    const modelInfo = llm.lastTriedModel ? ` (модель=${llm.lastTriedModel})` : '';
    return fallback({ text, sourceName, config, llmError: `${error?.message || 'невідома помилка'}${modelInfo}` });
  }
}
