import nodeFetch from 'node-fetch';

const fetchFn = globalThis.fetch || nodeFetch;

export async function analyzeWithGemini({ apiKey, model, text, timeoutMs = 12000, logger }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini API HTTP ${res.status}`);
    }

    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out) throw new Error('Gemini returned empty text');

    try {
      return JSON.parse(out);
    } catch {
      throw new Error('Gemini response is not valid JSON');
    }
  } catch (error) {
    logger?.warn('Gemini analyze error:', error?.message || error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
