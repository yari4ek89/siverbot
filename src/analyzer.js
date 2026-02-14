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

function detectRegionStringFromRaw(rawText) {
  const rawNorm = normalizeText(rawText);
  const hitsC = CHERNIHIV_PATTERNS.some((p) => rawNorm.includes(p));
  const hitsS = SUMY_PATTERNS.some((p) => rawNorm.includes(p));

  if (hitsC && hitsS) return 'both';
  if (hitsC) return 'chernihiv';
  if (hitsS) return 'sumy';
  return 'none';
}

export function detectRegionsFromRaw(rawText) {
  return toRegionHits(detectRegionStringFromRaw(rawText));
}

export function detectThreatFromRaw(rawText) {
  const rawNorm = normalizeText(rawText);
  if (KEYWORDS.uav.some((k) => rawNorm.includes(k))) return 'uav';
  if (KEYWORDS.missile.some((k) => rawNorm.includes(k))) return 'missile';
  if (KEYWORDS.aviation.some((k) => rawNorm.includes(k))) return 'aviation';
  if (KEYWORDS.air_defense.some((k) => rawNorm.includes(k))) return 'air_defense';
  return 'unknown';
}

function toRegionString(value) {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : 'none';
  }
  return typeof value === 'string' ? value : 'none';
}

function toRegionHits(region) {
  if (region === 'both') return ['both'];
  if (region === 'chernihiv') return ['chernihiv'];
  if (region === 'sumy') return ['sumy'];
  return ['none'];
}

function regionLabel(region) {
  if (region === 'both') return 'Чернігівщина + Сумщина';
  if (region === 'chernihiv') return 'Чернігівщина';
  if (region === 'sumy') return 'Сумщина';
  return 'Регіон не визначено';
}

function titleByThreat(threatType, region) {
  const regionText = regionLabel(region);
  const map = {
    uav: `БПЛА: ${regionText}`,
    missile: `Ракетна небезпека: ${regionText}`,
    aviation: `Авіаційна загроза: ${regionText}`,
    air_defense: `Повітряна небезпека: ${regionText}`,
    unknown: `Повітряна загроза: ${regionText}`,
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

function buildSummaryFromRaw({ threatType, region, rawText }) {
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
  return `Зафіксовано повідомлення про ${threatLabel} у межах регіону ${regionLabel(region)}.${locText}${dirText}`;
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function finalizeResult(result) {
  result.regions = toRegionString(result.regions);
  result.threat_type = result.threat_type || 'unknown';
  result.confidence = clampConfidence(result.confidence);

  if (result.regions && result.regions !== 'none' && result.threat_type && result.threat_type !== 'unknown') {
    result.should_post = true;
  } else {
    result.should_post = false;
  }

  result.title = sanitizeOutput(result.title || '');
  result.summary = sanitizeOutput(result.summary || '');
  result.reason = sanitizeOutput(result.reason || '');
  result.language = 'uk';

  // compatibility fields for existing code
  result.shouldPost = result.should_post;
  result.regionHits = toRegionHits(result.regions);
  result.threatType = result.threat_type;

  return result;
}

function buildFallbackResult({ rawText, sourceName, config, llmError }) {
  const profile = getSourceProfile(sourceName, config);
  const detectedRegion = detectRegionStringFromRaw(rawText);
  let detectedThreat = detectThreatFromRaw(rawText);

  if (detectedThreat === 'unknown' && profile.allowLocationOnly && detectedRegion !== 'none') {
    detectedThreat = profile.defaultThreatType;
  }

  const locationOnly = detectThreatFromRaw(rawText) === 'unknown' && profile.allowLocationOnly && detectedRegion !== 'none';

  const result = {
    should_post: false,
    regions: detectedRegion,
    threat_type: detectedThreat,
    confidence: locationOnly ? 0.65 : 0.5,
    title: titleByThreat(detectedThreat, detectedRegion),
    summary: buildSummaryFromRaw({ threatType: detectedThreat, region: detectedRegion, rawText }),
    reason: locationOnly
      ? 'Локація з профільного радара інтерпретована як повітряна загроза.'
      : `LLM error: ${shortError(llmError || 'недоступний')}`,
  };

  return finalizeResult(result);
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

    const detectedRegion = detectRegionStringFromRaw(rawText);
    const detectedThreat = detectThreatFromRaw(rawText);

    const result = {
      should_post: Boolean(parsed.should_post),
      regions: toRegionString(parsed.regions),
      threat_type: parsed.threat_type || 'unknown',
      confidence: Number(parsed.confidence ?? 0),
      title: parsed.title || titleByThreat(parsed.threat_type || 'unknown', toRegionString(parsed.regions)),
      summary: parsed.summary || buildSummaryFromRaw({ threatType: parsed.threat_type || 'unknown', region: toRegionString(parsed.regions), rawText }),
      reason: parsed.reason || 'Класифікація виконана LLM',
    };

    if (detectedRegion !== 'none') {
      result.regions = detectedRegion;
    }
    if (detectedThreat !== 'unknown') {
      result.threat_type = detectedThreat;
    }

    return finalizeResult(result);
  } catch (error) {
    const llm = getLlmStatus();
    const modelInfo = llm.lastTriedModel ? ` (модель=${llm.lastTriedModel})` : '';
    return buildFallbackResult({
      rawText,
      sourceName,
      config,
      llmError: `${error?.message || 'невідома помилка'}${modelInfo}`,
    });
  }
}
