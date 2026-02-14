const SOURCE_WORDS_RE = /\b(джерело|джерела|источник|источники|канал|канали|channel|source)\b/giu;

export function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/t\.me\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.,:;!?()\-"'«»]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeOutput(text = '') {
  return String(text)
    .replace(/@\w+/g, ' ')
    .replace(SOURCE_WORDS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
