import crypto from 'node:crypto';

export function signatureFor(event) {
  return crypto.createHash('sha1').update(`${event.source}|${event.category}|${event.normalized_text}`).digest('hex');
}

export function isDuplicate(db, signature, windowMin) {
  const row = db.prepare(`SELECT id FROM published WHERE signature=? AND datetime(created_at)>=datetime('now', ?) LIMIT 1`).get(signature, `-${windowMin} minutes`);
  return Boolean(row);
}
