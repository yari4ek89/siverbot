const patterns = {
  coords: /\b(?:\d{1,2}\.\d{3,}\s*,\s*\d{1,3}\.\d{3,}|[A-Z0-9]{4,}\+[A-Z0-9]{2,}|\d{1,2}°\s*\d{1,2}'\s*\d{1,2}(?:\.\d+)?"?\s*[NS])\b|google\.com\/maps|maps\.app\.goo\.gl|openstreetmap\.org/iu,
  address: /\b(вул\.?|вулиця|просп\.?|пров\.?|площа|буд\.?|street|st\.)\s+[\p{L}\d'’\- ]{2,}\s*\d+[а-яa-z]?\b/iu,
  route: /\b(курс|вектор|летить\s+на|через\s+\d+\s*хв|маршрут|напрямок\s+на|траєктор|куди\s+летить)\b/iu,
};

export function hasUnsafe(text = '') {
  return Object.values(patterns).some((re) => re.test(text));
}

export function redactUnsafe(text = '') {
  let out = text;
  for (const re of Object.values(patterns)) out = out.replace(re, '[приховано з міркувань безпеки]');
  return out;
}
