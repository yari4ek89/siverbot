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
  'вакалівщина', 'вакаливщина', 'ніжин', 'прилуки', 'бахмач', 'корюківка', 'новгород-сіверський',
  'суми', 'сумська область', 'конотоп', 'шостка', 'охтирка', 'глухів', 'ромни', 'путивль', 'тростянець',
  'чернігів', 'чернігівщина',
];

function shortError(message, limit = 200) {
  if (!message) return 'невідома помилка';
  return sanitizeOutput(String(message).replace(/\s+/g, ' ').trim().slice(0, limit));
}

function dedupeLimit(arr, limit = 3) {
  return [...new Set(arr.filter(Boolean))].slice(0, limit);
}

function normalizeLocationLabel(loc) {
  return sanitizeOutput(loc).replace(/^\p{L}/u, (x) => x.toUpperCase());
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
  const region = detectRegionStringFromRaw(rawText);
  if (region === 'both') return ['both'];
  if (region === 'chernihiv') return ['chernihiv'];
  if (region === 'sumy') return ['sumy'];
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

function extractLocationsFromRaw(rawText) {
  const rawNorm = normalizeText(rawText);
  const found = [];
  for (const loc of KNOWN_LOCATIONS) {
    if (rawNorm.includes(loc)) found.push(normalizeLocationLabel(loc));
  }
  return dedupeLimit(found, 3);
}

function extractDirectionsFromRaw(rawText) {
  const patterns = [
    /\bв\s+бік\s+[\p{L}\p{N}\-\s]{2,40}/giu,
    /\bкурс\s+на\s+[\p{L}\p{N}\-\s]{2,40}/giu,
    /\bнапрямок\s+[\p{L}\p{N}\-\s]{2,40}/giu,
  ];
  const out = [];
  for (const re of patterns) {
    for (const m of rawText.match(re) || []) {
      out.push(sanitizeOutput(m).replace(/\.$/, '').trim());
    }
  }
  return dedupeLimit(out, 3);
}

function toRegionString(value) {
  if (Array.isArray(value) && value.length) return String(value[0]);
  if (typeof value === 'string') return value;
  return 'none';
}

function toRegionHits(region) {
  if (region === 'both') return ['both'];
  if (region === 'chernihiv') return ['chernihiv'];
  if (region === 'sumy') return ['sumy'];
  return ['none'];
}

function titleByThreat(threatType, region) {
  const regionText = region === 'both' ? 'Чернігівщині й Сумщині' : region === 'chernihiv' ? 'Чернігівщині' : region === 'sumy' ? 'Сумщині' : 'регіону';
  const map = {
    uav: `Є БПЛА по ${regionText}.`,
    missile: `Ракетна небезпека по ${regionText}.`,
    aviation: `Авіаційна активність по ${regionText}.`,
    air_defense: `Робота ППО по ${regionText}.`,
    unknown: `Є повітряна загроза по ${regionText}.`,
  };
  return map[threatType] || map.unknown;
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function finalizeResult(result) {
  result.regions = toRegionString(result.regions);
  result.threat_type = result.threat_type || 'unknown';

  if (result.regions && result.regions !== 'none' && result.threat_type && result.threat_type !== 'unknown') {
    result.should_post = true;
  } else {
    result.should_post = false;
  }

  result.confidence = clampConfidence(result.confidence);
  result.title = sanitizeOutput(result.title || '');
  result.summary = sanitizeOutput(result.summary || '');
  result.reason = sanitizeOutput(result.reason || '');
  result.locations = dedupeLimit((result.locations || []).map((x) => sanitizeOutput(x)), 3);
  result.directions = dedupeLimit((result.directions || []).map((x) => sanitizeOutput(x)), 3);
  result.language = 'uk';

  // backward-compatible aliases
  result.shouldPost = result.should_post;
  result.regionHits = toRegionHits(result.regions);
  result.threatType = result.threat_type;

  return result;
}

function buildFallbackResult({ rawText, sourceName, config, llmError }) {
  const profile = getSourceProfile(sourceName, config);
  const detectedRegion = detectRegionStringFromRaw(rawText);
  let detectedThreat = detectThreatFromRaw(rawText);
  const locations = extractLocationsFromRaw(rawText);
  const directions = extractDirectionsFromRaw(rawText);

  if (detectedThreat === 'unknown' && profile.allowLocationOnly && detectedRegion !== 'none') {
    detectedThreat = profile.defaultThreatType;
  }

  return finalizeResult({
    should_post: false,
    regions: detectedRegion,
    threat_type: detectedThreat,
    confidence: profile.allowLocationOnly && detectedRegion !== 'none' ? 0.65 : 0.5,
    title: titleByThreat(detectedThreat, detectedRegion),
    summary: locations.length
      ? `Локації: ${locations.join(', ')}.`
      : 'Деталей по локаціях поки немає.',
    reason: `LLM error: ${shortError(llmError || 'недоступний')}`,
    locations,
    directions,
  });
}

export async function analyzeMessage({ text, sourceName, regions, config, logger }) {
  const rawText = text || '';
  const profile = getSourceProfile(sourceName, config);

  const prompt = `Ти класифікатор повідомлень про повітряні загрози. Поверни СУВОРО JSON:
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
- Пиши українською, коротко і по-людськи.
- НЕ згадуй джерела/канали/@юзернейми.
- Локації/напрямки можна згадувати тільки якщо вони є в оригінальному тексті.
- Без координат, без прогнозів, без трактувань.
- Джерело: ${sourceName}. Профіль: defaultThreatType=${profile.defaultThreatType}, allowLocationOnly=${profile.allowLocationOnly}.
- Якщо невпевнено, should_post=false.
Дозволені регіони: ${regions.join(',')}
Текст:\n${rawText}`;

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
    const locations = extractLocationsFromRaw(rawText);
    const directions = extractDirectionsFromRaw(rawText);

    const result = {
      should_post: Boolean(parsed.should_post),
      regions: toRegionString(parsed.regions),
      threat_type: parsed.threat_type || 'unknown',
      confidence: Number(parsed.confidence ?? 0),
      title: parsed.title || titleByThreat(parsed.threat_type || 'unknown', toRegionString(parsed.regions)),
      summary: parsed.summary || (locations.length ? `Локації: ${locations.join(', ')}.` : 'Деталей по локаціях поки немає.'),
      reason: parsed.reason || 'Класифікація виконана LLM',
      locations,
      directions,
    };

    if (detectedRegion !== 'none') result.regions = detectedRegion;
    if (detectedThreat !== 'unknown') result.threat_type = detectedThreat;

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
