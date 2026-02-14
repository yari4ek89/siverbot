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
const SUMY_PATTERNS = ['сум', 'сумщ', 'сумська', 'суми', 'конотоп', 'шостк', 'охтирк', 'глухів', 'ромн', 'путивл', 'вакалівщина', 'вакаливщина', 'vakalyvshchyna', 'vakalivshchyna'];

const KNOWN_LOCATIONS = [
  'вакалівщина', 'вакаливщина', 'vakalyvshchyna', 'vakalivshchyna',
  'ніжин', 'нежин', 'прилуки', 'прилук', 'бахмач', 'корюківка', 'корюків', 'новгород-сіверський', 'новгород сівер',
  'суми', 'сумська область', 'конотоп', 'шостка', 'охтирка', 'глухів', 'ромни', 'путивль', 'путивля', 'тростянець',
  'чернігів', 'чернігівщина', 'чернигов',
];

function shortError(message, limit = 200) {
  if (!message) return 'невідома помилка';
  return sanitizeOutput(String(message).replace(/\s+/g, ' ').trim().slice(0, limit));
}

export function detectRegionsFromRaw(rawText) {
  const rawNorm = normalizeText(rawText);
  const hitsC = CHERNIHIV_PATTERNS.some((p) => rawNorm.includes(p));
  const hitsS = SUMY_PATTERNS.some((p) => rawNorm.includes(p));

  if (hitsC && hitsS) return ['both'];
  if (hitsC) return ['chernihiv'];
  if (hitsS) return ['sumy'];
  return ['none'];
}

export function detectThreatFromRaw(rawText) {
  const rawNorm = normalizeText(rawText);
  if (KEYWORDS.uav.some((k) => rawNorm.includes(k))) return 'uav';
  if (KEYWORDS.missile.some((k) => rawNorm.includes(k))) return 'missile';
  if (KEYWORDS.aviation.some((k) => rawNorm.includes(k))) return 'aviation';
  if (KEYWORDS.air_defense.some((k) => rawNorm.includes(k))) return 'air_defense';
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
  return map[threatType] || map.unknown;
}

function extractDirectionPhrases(rawText) {
  const out = [];
  const patterns = [
    /\bв\s+бік\s+[\p{L}\p{N}\-\s]{2,40}/giu,
    /\bкурс\s+на\s+[\p{L}\p{N}\-\s]{2,40}/giu,
    /\bнапрямок\s+[\p{L}\p{N}\-\s]{2,40}/giu,
  ];

  for (const re of patterns) {
    const matches = rawText.match(re) || [];
    for (const m of matches) {
      const clean = sanitizeOutput(m).slice(0, 60).trim();
      if (clean && !out.includes(clean)) out.push(clean);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

function extractLocationsFromRaw(rawText) {
  const rawNorm = normalizeText(rawText);
  const found = [];
  for (const loc of KNOWN_LOCATIONS) {
    if (rawNorm.includes(loc) && !found.includes(loc)) found.push(loc);
    if (found.length >= 3) break;
  }
  return found;
}

function buildSummaryFromRaw({ threatType, regions, rawText }) {
  const threatLabel = {
    uav: 'БПЛА',
    missile: 'ракетну небезпеку',
    aviation: 'авіаційну загрозу',
    air_defense: 'повітряну небезпеку',
    unknown: 'повітряну небезпеку',
  }[threatType] || 'повітряну небезпеку';

  const locations = extractLocationsFromRaw(rawText);
  const directions = extractDirectionPhrases(rawText);

  const locText = locations.length ? ` Локації з тексту: ${locations.join(', ')}.` : '';
  const dirText = directions.length ? ` Напрямки з тексту: ${directions.join('; ')}.` : '';
  return `Зафіксовано повідомлення про ${threatLabel} у межах регіону ${regionLabel(regions)}.${locText}${dirText}`;
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function finalizeResult(input) {
  const result = {
    shouldPost: Boolean(input.shouldPost),
    regionHits: Array.isArray(input.regionHits) && input.regionHits.length ? input.regionHits : ['none'],
    threatType: input.threatType || 'unknown',
    confidence: clampConfidence(input.confidence),
    title: sanitizeOutput(input.title || ''),
    summary: sanitizeOutput(input.summary || ''),
    reason: sanitizeOutput(input.reason || ''),
    language: 'uk',
  };

  const regionsNone = result.regionHits.includes('none');
  if (result.threatType === 'unknown' || regionsNone) {
    result.shouldPost = false;
  } else {
    result.shouldPost = true;
  }

  return result;
}

function fallbackResult({ rawText, sourceName, config, llmError }) {
  const regions = detectRegionsFromRaw(rawText);
  let threatType = detectThreatFromRaw(rawText);
  const profile = getSourceProfile(sourceName, config);

  if (threatType === 'unknown' && profile.allowLocationOnly && !regions.includes('none')) {
    threatType = profile.defaultThreatType;
  }

  const locationOnly = detectThreatFromRaw(rawText) === 'unknown' && profile.allowLocationOnly && !regions.includes('none');
  const title = titleByThreat(threatType, regions);
  const summary = buildSummaryFromRaw({ threatType, regions, rawText });
  const reason = locationOnly
    ? 'Локація з профільного радара інтерпретована як повітряна загроза.'
    : `LLM error: ${shortError(llmError || 'недоступний')}`;

  return finalizeResult({
    shouldPost: false,
    regionHits: regions,
    threatType,
    confidence: locationOnly ? 0.65 : 0.5,
    title,
    summary,
    reason,
  });
}

export async function analyzeMessage({ text, sourceName, regions, config, logger }) {
  const rawText = text || '';
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
Дозволені регіони: ${regions.join(',')}
Текст повідомлення:\n${rawText}`;

  try {
    const parsed = await analyzeWithGemini({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      text: prompt,
      timeoutMs: config.llmTimeoutMs,
      logger,
    });

    const result = {
      shouldPost: Boolean(parsed.should_post),
      regionHits: Array.isArray(parsed.regions) && parsed.regions.length ? parsed.regions : ['none'],
      threatType: parsed.threat_type || 'unknown',
      confidence: Number(parsed.confidence ?? 0),
      title: parsed.title || titleByThreat(parsed.threat_type || 'unknown', Array.isArray(parsed.regions) ? parsed.regions : ['none']),
      summary: parsed.summary || buildSummaryFromRaw({ threatType: parsed.threat_type || 'unknown', regions: Array.isArray(parsed.regions) ? parsed.regions : ['none'], rawText }),
      reason: parsed.reason || 'Класифікація виконана LLM',
    };

    return finalizeResult(result);
  } catch (error) {
    const llm = getLlmStatus();
    const modelInfo = llm.lastTriedModel ? ` (модель=${llm.lastTriedModel})` : '';
    return fallbackResult({
      rawText,
      sourceName,
      config,
      llmError: `${error?.message || 'невідома помилка'}${modelInfo}`,
    });
  }
}
