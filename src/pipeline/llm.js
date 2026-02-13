import config from '../config.js';
import { hasUnsafe, redactUnsafe } from './safety.js';

const SYS = `Ти безпековий класифікатор. Відповідай тільки JSON українською.
Не додавай нові факти.
Якщо є координати, адреси, маршрути, курс/вектор, прогноз часу (через N хв) => safe=false.
short_ua: 1-2 рядки, без точних локацій, координат, прогнозів.
Поверни: {"category":"official_notice|unverified_report|other","safe":true,"confidence":0,"short_ua":"","reasons":[""]}`;

export async function analyzeWithLLM(input, logger) {
  const hardUnsafe = hasUnsafe(input);
  const fallback = {
    category: 'unverified_report',
    safe: !hardUnsafe,
    confidence: hardUnsafe ? 90 : 50,
    short_ua: redactUnsafe(input).slice(0, 260),
    reasons: hardUnsafe ? ['Жорсткий safety фільтр'] : ['Fallback rule-based'],
  };

  if (!config.llm.apiKey) return fallback;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), config.llm.timeoutMs);
    const r = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: input.slice(0, 3000) }],
      }),
    });
    clearTimeout(t);
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const data = await r.json();
    const out = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return {
      category: out.category || fallback.category,
      safe: Boolean(out.safe) && !hardUnsafe,
      confidence: Number(out.confidence || fallback.confidence),
      short_ua: redactUnsafe(out.short_ua || fallback.short_ua).slice(0, 280),
      reasons: Array.isArray(out.reasons) ? out.reasons : fallback.reasons,
    };
  } catch (e) {
    logger.warn({ err: e.message }, 'LLM недоступний, fallback');
    return fallback;
  }
}
