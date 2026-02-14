const TOPONYMS = [
  "чернігів", "ніжин", "бахмач", "прилуки", "новгород-сіверськ", "корюків", "козелець",
  "сосниц", "семенів", "мена", "сновськ", "сум", "конотоп", "путивл", "шостк",
  "глухів", "ромн", "охтир", "тростянец", "білопіл", "лебедин"
];

const locationRegexes = [
  /(?:район\s+)([\p{L}\-']+)/giu,
  /([\p{L}\-']+)\s+район/giu,
  /(?:біля|поблизу|в районі|районі)\s+([\p{L}\-']+)/giu
];

const directionRegex = /(в бік|курс на|напрям(?:ок)? на)\s+([^;,.\n]+)/giu;

function uniq(values) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function extractLocations(text) {
  const found = [];

  for (const re of locationRegexes) {
    for (const match of text.matchAll(re)) {
      found.push(match[1]);
    }
  }

  const lower = text.toLowerCase();
  for (const toponym of TOPONYMS) {
    if (lower.includes(toponym)) {
      found.push(toponym);
    }
  }

  return uniq(found).slice(0, 3);
}

export function extractDirections(text) {
  const directions = [];

  for (const match of text.matchAll(directionRegex)) {
    directions.push(`${match[1]} ${match[2]}`.trim());
  }

  return uniq(directions).slice(0, 3);
}
