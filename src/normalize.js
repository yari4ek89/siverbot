export function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/t\.me\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.,:;!?()\-"'«»]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
