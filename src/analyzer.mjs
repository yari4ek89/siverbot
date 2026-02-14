import {
  normalizeText,
  detectRegions,
  detectThreatType,
  extractLocations,
  extractDirections,
  extractCount,
} from './extractors.mjs';

export function analyzeText(rawText) {
  const text = normalizeText(rawText || '');
  const regions = detectRegions(text);
  const threatType = detectThreatType(text);
  const locations = extractLocations(text);
  const directions = extractDirections(text);
  const count = extractCount(text);

  const shouldPost = regions !== 'none' && threatType !== 'unknown';

  return {
    should_post: shouldPost,
    regions,
    threat_type: threatType,
    locations,
    directions,
    count,
  };
}

export function buildEventKey(analysis) {
  const loc = [...new Set((analysis.locations || []).map((x) => normalizeText(x)))].sort().join('-') || 'noloc';
  const count = Number.isFinite(Number(analysis.count)) ? String(Number(analysis.count)) : 'nocount';
  return `${analysis.threat_type}|${analysis.regions}|${loc}|${count}`;
}

export function buildBaseKey(analysis) {
  return `${analysis.threat_type}|${analysis.regions}`;
}

export function isUpdate(prevMeta, analysis) {
  if (!prevMeta) return false;
  const prevLoc = new Set(prevMeta.locations || []);
  const nextLoc = new Set(analysis.locations || []);
  const expanded = [...nextLoc].some((x) => !prevLoc.has(x));

  const prevCount = Number.isFinite(Number(prevMeta.count)) ? Number(prevMeta.count) : null;
  const nextCount = Number.isFinite(Number(analysis.count)) ? Number(analysis.count) : null;
  const countUp = nextCount !== null && (prevCount === null || nextCount > prevCount);

  return expanded || countUp;
}
