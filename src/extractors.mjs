const CHERNIHIV_MARKERS = [
  'черніг', 'черниг', 'чернігів', 'ніжин', 'нежин', 'бахмач', 'козелець', 'новгород-сівер', 'новгород сівер', 'прилуки', 'прилук'
];

const SUMY_MARKERS = [
  'сум', 'сумщ', 'конотоп', 'путивль', 'шостк', 'глух', 'ромн', 'охтир', 'лебедин'
];

const TOPO_DICTIONARY = [
  'ніжин', 'бахмач', 'путивль', 'конотоп', 'шостка', 'глухів', 'чернігів', 'прилуки', 'новгород-сіверський', 'ромни'
];

export function normalizeText(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeOutput(text = '') {
  return String(text)
    .replace(/@\w+/g, '')
    .replace(/\b(джерело|джерела|источник|источники|канал|канали|source|channel)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectRegions(text) {
  const n = normalizeText(text);
  const c = CHERNIHIV_MARKERS.some((x) => n.includes(x));
  const s = SUMY_MARKERS.some((x) => n.includes(x));
  if (c && s) return 'both';
  if (c) return 'chernihiv';
  if (s) return 'sumy';
  return 'none';
}

export function detectThreatType(text) {
  const n = normalizeText(text);
  const hasUav = ['бпла', 'бплa', 'дрон', 'шахед', 'мопед', 'герань', 'uav', 'табун', 'рой', 'зграя', 'стадо', 'пачка', 'пакет'].some((x) => n.includes(x));
  if (hasUav) return 'uav';

  const hasMissile = ['ракета', 'ракетна небезпека', 'пуски', 'калібр', 'х-', 'крилат'].some((x) => n.includes(x));
  if (hasMissile) return 'missile';

  const hasPpo = ['ппо', 'робота ппо', 'збито', 'працює ппо'].some((x) => n.includes(x));
  if (hasPpo) return 'ppo';

  const hasAviation = ['авіа', 'літак', 'міг', 'су-'].some((x) => n.includes(x));
  if (hasAviation) return 'aviation';

  return 'unknown';
}

export function extractCount(text) {
  const n = normalizeText(text);
  const m = n.match(/\b(\d{1,2})\s*(бпла|дрон|ракет|літак|ціл)/);
  if (m) return Number(m[1]);
  return null;
}

export function extractLocations(text) {
  const n = normalizeText(text);
  const out = [];

  const rg1 = [...n.matchAll(/район\s+([а-яіїєґ\-']{3,})/g)].map((m) => `район ${m[1]}`);
  const rg2 = [...n.matchAll(/([а-яіїєґ\-']{3,})\s+район/g)].map((m) => `${m[1]} район`);

  for (const x of [...rg1, ...rg2]) if (!out.includes(x)) out.push(x);
  for (const t of TOPO_DICTIONARY) if (n.includes(t) && !out.includes(t)) out.push(t);

  return out.slice(0, 3);
}

export function extractDirections(text) {
  const n = normalizeText(text);
  const dirs = [...n.matchAll(/(?:в\s+бік|курс\s+на|напрям(?:ок)?\s+на)\s+[^;,.!\n]+/g)]
    .map((m) => m[0].trim());
  return dirs.slice(0, 3);
}
