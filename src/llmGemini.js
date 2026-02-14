import nodeFetch from 'node-fetch';

const fetchFn = globalThis.fetch || nodeFetch;

const llmStatus = {
  enabled: true,
  lastError: null,
  lastCallAt: null,
};

export function getLlmStatus() {
  return { ...llmStatus };
}

export async function analyzeWithGemini({ apiKey, model, text, timeoutMs = 12000, logger }) {
  llmStatus.enabled = Boolean(apiKey);

  if (!apiKey) {
    llmStatus.lastError = 'LLM disabled: missing GEMINI_API_KEY';
    throw new Error(llmStatus.lastError);
  }

  llmStatus.lastCallAt = new Date().toISOString();
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
      let details = '';
      try {
        const errBody = await res.json();
        details = errBody?.error?.message || '';
      } catch {
        details = '';
      }
      llmStatus.lastError = details ? `Gemini API HTTP ${res.status}: ${details}` : `Gemini API HTTP ${res.status}`;
      throw new Error(llmStatus.lastError);
    }

    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out) {
      llmStatus.lastError = 'Gemini returned empty text';
      throw new Error(llmStatus.lastError);
    }

    try {
      const parsed = JSON.parse(out);
      llmStatus.lastError = null;
      return parsed;
    } catch {
      llmStatus.lastError = 'Gemini response is not valid JSON';
      throw new Error(llmStatus.lastError);
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      llmStatus.lastError = 'LLM timeout';
      logger?.warn('Gemini analyze error: timeout');
      throw new Error('LLM timeout');
    }

    if (!llmStatus.lastError) {
      llmStatus.lastError = error?.message || 'Gemini unknown error';
    }

    logger?.warn('Gemini analyze error:', llmStatus.lastError);
    throw new Error(llmStatus.lastError);
  } finally {
    clearTimeout(timer);
  }
}
