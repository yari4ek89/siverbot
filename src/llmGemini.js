import nodeFetch from 'node-fetch';

const fetchFn = globalThis.fetch || nodeFetch;

const llmStatus = {
  enabled: true,
  activeModel: null,
  lastError: null,
  lastCallAt: null,
  lastTriedModel: null,
  lastModels: [],
};

function shortError(message, limit = 200) {
  if (!message) return 'unknown';
  return String(message).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function buildCandidateModels(modelFromEnv) {
  const base = (modelFromEnv || '').trim() || 'gemini-1.5-flash';
  const candidates = [
    base,
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-1.0-pro',
  ];

  return [...new Set(candidates)];
}

function parseModelName(raw) {
  if (!raw) return null;
  return String(raw).replace(/^models\//, '').trim();
}

export function getLlmStatus() {
  return {
    enabled: llmStatus.enabled,
    activeModel: llmStatus.activeModel,
    lastError: llmStatus.lastError,
    lastCallAt: llmStatus.lastCallAt,
    lastTriedModel: llmStatus.lastTriedModel,
    lastModels: [...llmStatus.lastModels],
  };
}

export async function listModels({ apiKey, logger }) {
  llmStatus.enabled = Boolean(apiKey);
  if (!apiKey) {
    llmStatus.lastError = 'LLM disabled: missing GEMINI_API_KEY';
    return [];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetchFn(url, { method: 'GET' });
    if (!res.ok) {
      let details = '';
      try {
        const errBody = await res.json();
        details = errBody?.error?.message || '';
      } catch {
        details = '';
      }
      const errMsg = details ? `List models HTTP ${res.status}: ${details}` : `List models HTTP ${res.status}`;
      llmStatus.lastError = shortError(errMsg);
      return [];
    }

    const data = await res.json();
    const names = (data?.models || [])
      .map((m) => parseModelName(m?.name))
      .filter(Boolean);

    llmStatus.lastModels = names.slice(-10);
    if (!llmStatus.lastError) llmStatus.lastError = null;
    return llmStatus.lastModels;
  } catch (error) {
    llmStatus.lastError = shortError(error?.message || 'List models failed');
    logger?.warn('Gemini listModels error:', llmStatus.lastError);
    return [];
  }
}

async function callGenerateContent({ apiKey, model, text, timeoutMs }) {
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

      const status = res.status;
      const errMsg = details ? `Gemini API HTTP ${status}: ${details}` : `Gemini API HTTP ${status}`;
      const error = new Error(errMsg);
      error.httpStatus = status;
      throw error;
    }

    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out) throw new Error('Gemini returned empty text');

    return JSON.parse(out);
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeWithGemini({ apiKey, model, text, timeoutMs = 12000, logger }) {
  llmStatus.enabled = Boolean(apiKey);

  if (!apiKey) {
    llmStatus.lastError = 'LLM disabled: missing GEMINI_API_KEY';
    throw new Error(llmStatus.lastError);
  }

  llmStatus.lastCallAt = new Date().toISOString();

  const candidates = llmStatus.activeModel
    ? [llmStatus.activeModel, ...buildCandidateModels(model)]
    : buildCandidateModels(model);
  const uniqueCandidates = [...new Set(candidates)];

  let lastError = null;

  for (const candidate of uniqueCandidates) {
    llmStatus.lastTriedModel = candidate;
    try {
      const parsed = await callGenerateContent({
        apiKey,
        model: candidate,
        text,
        timeoutMs,
      });
      llmStatus.activeModel = candidate;
      llmStatus.lastError = null;
      return parsed;
    } catch (error) {
      if (error?.name === 'AbortError') {
        llmStatus.lastError = `LLM timeout (model=${candidate})`;
        logger?.warn('Gemini analyze error:', llmStatus.lastError);
        throw new Error(llmStatus.lastError);
      }

      lastError = error;
      const status = error?.httpStatus;
      const short = shortError(error?.message || 'Gemini call failed');

      if (status === 404) {
        llmStatus.lastError = `Model not found: ${candidate}`;
        logger?.warn(`Gemini model unavailable: ${candidate}`);
        continue;
      }

      llmStatus.lastError = `${short} (model=${candidate})`;
      logger?.warn('Gemini analyze error:', llmStatus.lastError);
      throw new Error(llmStatus.lastError);
    }
  }

  const msg = shortError(lastError?.message || 'No working Gemini model found');
  llmStatus.lastError = `${msg} (tried: ${uniqueCandidates.join(', ')})`;
  throw new Error(llmStatus.lastError);
}
