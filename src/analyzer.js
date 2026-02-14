import { analyzeWithGemini } from './llmGemini.js';
import { normalizeText, sanitizeOutput } from './normalize.js';
import { getSourceProfile } from './sourceProfile.js';

const REGION_MARKERS = {
  chernihiv: ['черніг', 'черниг', 'чернігівщ', 'ніжин', 'бахмач', 'прилук', 'корюків', 'новгород-сівер', 'сіверщина'],
  sumy: ['сум', 'сумщ', 'сумська', 'конотоп', 'шостк', 'охтирк', 'глухів', 'ромн', 'путивл', 'вакалівщина', 'вакаливщина'],
};

const LOCATION_DICT = [
  'чернігів', 'чернігівщина', 'ніжин', 'бахмач', 'прилуки', 'корюківка', 'новгород-сіверський',
  'суми', 'сумська область', 'конотоп', 'шостка', 'охтирка', 'глухів', 'ромни', 'путивль', 'вакалівщина', 'вакаливщина',
];

const THREAT_PATTERNS = {
  uav: ['бпла', 'бплa', 'дрон', 'шахед', 'мопед', 'герань', 'uav', 'табун', 'рой', 'зграя', 'стадо', 'пачка', 'пакет', 'мопеди'],
  missile: ['ракета', 'ракетна небезпека', 'пуски', 'калібр', 'х-'],
  air_defense: ['ппо', 'робота ппо', 'збито', 'працює ппо'],
  aviation: ['авіа', 'літак', 'міг', 'су'],
};

const DIRECTION_RE = [
  /\bв\s+бік\s+[\p{L}\p{N}\-\s]{2,40}/giu,
  /\bкурс\s+на\s+[\p{L}\p{N}\-\s]{2,40}/giu,
  /\bнапрямок\s+[\p{L}\p{N}\-\s]{2,40}/giu,
];

function dedupe(arr, max = 3) {
  return [...new Set(arr.filter(Boolean))].slice(0, max);
}

function detectRegions(rawText) {
  const n = normalizeText(rawText);
  const c = REGION_MARKERS.chernihiv.some((x) => n.includes(x));
  const s = REGION_MARKERS.sumy.some((x) => n.includes(x));
  if (c && s) return 'both';
  if (c) return 'chernihiv';
  if (s) return 'sumy';
  return 'none';
}

function detectThreat(rawText) {
  const n = normalizeText(rawText);
  for (const [type, words] of Object.entries(THREAT_PATTERNS)) {
    if (words.some((w) => n.includes(w))) return type;
  }
  return 'unknown';
}

function extractLocations(rawText) {
  const n = normalizeText(rawText);
  return dedupe(LOCATION_DICT.filter((l) => n.includes(normalizeText(l))).map((l) => sanitizeOutput(l)), 3);
}

function extractDirections(rawText) {
  const out = [];
  for (const re of DIRECTION_RE) {
    for (const m of rawText.match(re) || []) out.push(sanitizeOutput(m).replace(/\.$/, '').trim());
  }
  return dedupe(out, 3);
}

function extractCount(rawText, threatType) {
  const n = normalizeText(rawText);
  const m = n.match(/\b\d{1,3}\b/);
  if (!m) return null;
  const v = Number(m[0]);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (threatType === 'uav' || threatType === 'missile') return v;
  return null;
}

function regionHasMarkers(rawText) {
  return detectRegions(rawText) !== 'none';
}

function hasAirThreatLike(rawText) {
  return detectThreat(rawText) !== 'unknown';
}

export function shouldPreFilterPass(rawText) {
  return regionHasMarkers(rawText) || hasAirThreatLike(rawText);
}

function isAmbiguous(rawText, profile) {
  const n = normalizeText(rawText);
  const hasSlang = ['табун', 'рой', 'зграя', 'стадо', 'пачка', 'пакет', 'мопеди'].some((w) => n.includes(w));
  const hasRegion = detectRegions(rawText) !== 'none';
  const threatUnknown = detectThreat(rawText) === 'unknown';
  const onlyLocations = hasRegion && threatUnknown;

  return (hasSlang && hasRegion) || (onlyLocations && profile.allowLocationOnly);
}

function toRegionHits(region) {
  if (region === 'both') return ['both'];
  if (region === 'chernihiv') return ['chernihiv'];
  if (region === 'sumy') return ['sumy'];
  return ['none'];
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function humanTitle(threat, region) {
  const r = region === 'both' ? 'Чернігівщині й Сумщині' : region === 'chernihiv' ? 'Чернігівщині' : region === 'sumy' ? 'Сумщині' : 'регіону';
  if (threat === 'uav') return `Є БПЛА по ${r}.`;
  if (threat === 'missile') return `Ракетна небезпека по ${r}.`;
  if (threat === 'air_defense') return `Робота ППО по ${r}.`;
  if (threat === 'aviation') return `Авіаційна активність по ${r}.`;
  return `Є повітряна загроза по ${r}.`;
}

function finalize(result) {
  result.regions = result.regions || 'none';
  result.threat_type = result.threat_type || 'unknown';
  result.should_post = result.regions !== 'none' && result.threat_type !== 'unknown';
  result.confidence = clamp01(result.confidence);
  result.title = sanitizeOutput(result.title || '');
  result.summary = sanitizeOutput(result.summary || '');
  result.reason = sanitizeOutput(result.reason || '');
  result.locations = dedupe((result.locations || []).map((x) => sanitizeOutput(x)), 3);
  result.directions = dedupe((result.directions || []).map((x) => sanitizeOutput(x)), 3);
  result.count = Number.isFinite(Number(result.count)) ? Number(result.count) : null;
  result.language = 'uk';

  result.shouldPost = result.should_post;
  result.regionHits = toRegionHits(result.regions);
  result.threatType = result.threat_type;
  return result;
}

export function buildEventKey(analyzed) {
  const threat = normalizeText(analyzed.threat_type || analyzed.threatType || 'unknown');
  const region = normalizeText(analyzed.regions || analyzed.regionHits?.[0] || 'none');
  const locations = dedupe((analyzed.locations || []).map((x) => normalizeText(x))).sort().join('-') || 'noloc';
  const count = Number.isFinite(Number(analyzed.count)) ? String(Number(analyzed.count)) : 'nocount';
  return `${threat}|${region}|${locations}|${count}`;
}

export function buildBaseEventKey(analyzed) {
  const threat = normalizeText(analyzed.threat_type || analyzed.threatType || 'unknown');
  const region = normalizeText(analyzed.regions || analyzed.regionHits?.[0] || 'none');
  return `${threat}|${region}`;
}

export function isUpdateCompared(prev, next) {
  if (!prev) return false;
  const prevLoc = new Set(prev.locations || []);
  const nextLoc = new Set(next.locations || []);
  const expandedLocations = [...nextLoc].some((x) => !prevLoc.has(x));
  const prevCount = Number.isFinite(Number(prev.count)) ? Number(prev.count) : null;
  const nextCount = Number.isFinite(Number(next.count)) ? Number(next.count) : null;
  const increasedCount = nextCount !== null && (prevCount === null || nextCount > prevCount);
  return expandedLocations || increasedCount;
}

async function maybeLLM(rawText, sourceName, config, llmContext, profile) {
  if (!llmContext || llmContext.mode !== 'smart') return null;
  if (!config.geminiApiKey) return null;
  if (llmContext.cooldownUntil && Date.now() < llmContext.cooldownUntil) return null;
  if (!isAmbiguous(rawText, profile)) return null;

  try {
    const parsed = await analyzeWithGemini({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      timeoutMs: config.llmTimeoutMs,
      logger: llmContext.logger,
      text: `Поверни тільки JSON з полями should_post, regions, threat_type, confidence, title, summary, reason.\nПиши українською.\nБез згадок джерел/каналів/@username.\nБез координат та прогнозів.\nТекст:\n${rawText}`,
    });

    return {
      should_post: Boolean(parsed.should_post),
      regions: Array.isArray(parsed.regions) ? String(parsed.regions[0] || 'none') : 'none',
      threat_type: parsed.threat_type || 'unknown',
      confidence: Number(parsed.confidence ?? 0.55),
      title: parsed.title || '',
      summary: parsed.summary || '',
      reason: parsed.reason || 'Уточнення LLM для спірного випадку',
    };
  } catch (error) {
    const msg = String(error?.message || 'LLM error');
    if (msg.includes('429') && llmContext?.setCooldown) {
      llmContext.setCooldown(Date.now() + 15 * 60 * 1000);
    }
    if (llmContext?.setLastError) llmContext.setLastError(msg);
    return null;
  }
}

export async function analyzeMessage({ text, sourceName, regions, config, logger, llmContext }) {
  const rawText = text || '';
  const profile = getSourceProfile(sourceName, config);

  const prefilterPass = shouldPreFilterPass(rawText);
  if (!prefilterPass) {
    return finalize({
      should_post: false,
      regions: 'none',
      threat_type: 'unknown',
      confidence: 0,
      title: '',
      summary: '',
      reason: 'Відсічено pre-filter.',
      locations: [],
      directions: [],
      count: null,
    });
  }

  let result = {
    should_post: false,
    regions: detectRegions(rawText),
    threat_type: detectThreat(rawText),
    confidence: 0.7,
    title: '',
    summary: '',
    reason: 'Rule-based класифікація.',
    locations: extractLocations(rawText),
    directions: extractDirections(rawText),
    count: null,
  };

  if (result.threat_type === 'unknown' && profile.allowLocationOnly && result.regions !== 'none') {
    result.threat_type = profile.defaultThreatType;
    result.confidence = 0.65;
    result.reason = 'Локаційне повідомлення з профільного джерела.';
  }

  result.count = extractCount(rawText, result.threat_type);

  const llmResolved = await maybeLLM(rawText, sourceName, config, { ...llmContext, logger }, profile);
  if (llmResolved) {
    result = {
      ...result,
      ...llmResolved,
      locations: extractLocations(rawText),
      directions: extractDirections(rawText),
      count: extractCount(rawText, llmResolved.threat_type || result.threat_type),
    };
  }

  result.title = result.title || humanTitle(result.threat_type, result.regions);
  result.summary = result.locations.length
    ? `Локації: ${result.locations.join(', ')}.`
    : 'Деталей по локаціях поки немає.';

  return finalize(result);
}
