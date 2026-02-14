import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { StateStore } from './stateStore.js';
import { normalizeText, sanitizeOutput } from './normalize.js';
import { createGramClient } from './gramjsClient.js';
import { ChannelFetcher } from './channelFetcher.js';
import { analyzeMessage } from './analyzer.js';
import { postEvent, buildPreviewText } from './poster.js';
import { getLlmStatus, listModels } from './llmGemini.js';
import { getSourceProfile } from './sourceProfile.js';

const logger = createLogger(config.logLevel);
const bot = new Telegraf(config.botToken);
const stateStore = new StateStore(config.stateFile);
stateStore.loadState();
if (!stateStore.getLlmMode()) stateStore.setLlmMode(config.llmMode || 'off');


const gramStatus = {
  enabled: true,
  initialized: false,
  client: null,
  fetcher: null,
  lastInitError: null,
  lastTickStats: null,
  lastTickAt: null,
  lastTickReason: null,
  lastTickError: 'none',
  isTickRunning: false,
  schedulerStarted: false,
  schedulerTimer: null,
  lastPostAt: null,
  lastPostOk: null,
  lastPostError: 'none',
};

function isAdmin(ctx) {
  return Number(ctx.from?.id) === config.adminUserId;
}

function shortError(message, limit = 200) {
  if (!message) return 'none';
  return String(message).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function dedupe(arr, max = 3) {
  return [...new Set((arr || []).filter(Boolean))].slice(0, max);
}

function buildEventKey(analysis) {
  const threat = normalizeText(analysis.threat_type || analysis.threatType || 'unknown');
  const region = normalizeText(analysis.regions || analysis.regionHits?.[0] || 'none');
  const locations = dedupe((analysis.locations || []).map((x) => normalizeText(x))).sort().join('-') || 'noloc';
  const count = Number.isFinite(Number(analysis.count)) ? String(Number(analysis.count)) : 'nocount';
  return `${threat}|${region}|${locations}|${count}`;
}

function buildBaseEventKey(analysis) {
  const threat = normalizeText(analysis.threat_type || analysis.threatType || 'unknown');
  const region = normalizeText(analysis.regions || analysis.regionHits?.[0] || 'none');
  return `${threat}|${region}`;
}

function isUpdateCompared(prev, next) {
  if (!prev) return false;
  const prevLoc = new Set(prev.locations || []);
  const nextLoc = new Set(next.locations || []);
  const expandedLocations = [...nextLoc].some((x) => !prevLoc.has(x));
  const prevCount = Number.isFinite(Number(prev.count)) ? Number(prev.count) : null;
  const nextCount = Number.isFinite(Number(next.count)) ? Number(next.count) : null;
  const increasedCount = nextCount !== null && (prevCount === null || nextCount > prevCount);
  return expandedLocations || increasedCount;
}

function getEventTtlMin(threatType) {
  if (threatType === 'uav') return 20;
  if (threatType === 'missile') return 10;
  if (threatType === 'air_defense') return 15;
  if (threatType === 'aviation') return 15;
  return config.dedupTtlMin;
}

function formatAnalysis(analysis) {
  return [
    `should_post=${analysis.should_post ?? analysis.shouldPost}`,
    `regions=${analysis.regions ?? analysis.regionHits?.join(',')}`,
    `threat_type=${analysis.threat_type ?? analysis.threatType}`,
    `confidence=${analysis.confidence}`,
    `title=${sanitizeOutput(analysis.title || '')}`,
    `summary=${sanitizeOutput(analysis.summary || '')}`,
    `reason=${sanitizeOutput(analysis.reason || '')}`,
    `count=${analysis.count ?? 'none'}`,
    `locations=${(analysis.locations || []).join(', ') || 'none'}`,
    `directions=${(analysis.directions || []).join(', ') || 'none'}`,
  ].join('\n');
}

function getLlmContext() {
  return {
    mode: stateStore.getLlmMode(),
    cooldownUntil: stateStore.getLlmCooldownUntil(),
    setCooldown: (ts) => stateStore.setLlmCooldownUntil(ts),
    setLastError: (err) => stateStore.setLlmLastError(err),
  };
}

async function initGramIfPossible() {
  try {
    gramStatus.client = await createGramClient({ apiId: config.tgApiId, apiHash: config.tgApiHash, sessionString: config.tgSessionString });
    gramStatus.fetcher = new ChannelFetcher(gramStatus.client, config.sourceChannels, config.fetchLimit, stateStore, logger);
    gramStatus.initialized = true;
    gramStatus.lastInitError = null;
    logger.info('GramJS initialized successfully');
  } catch (error) {
    gramStatus.initialized = false;
    gramStatus.lastInitError = error?.message || String(error);
    logger.error('GramJS init failed:', gramStatus.lastInitError);
  }
}

async function handleApprovedPost(analysis, eventKey) {
  if (!config.targetChatId) {
    gramStatus.lastPostAt = new Date().toISOString();
    gramStatus.lastPostOk = false;
    gramStatus.lastPostError = 'targetChatId missing';
    throw new Error('targetChatId missing');
  }

  await postEvent({
    bot,
    targetChatId: config.targetChatId,
    event: { analysis, sources: [] },
    onSuccess: () => {
      gramStatus.lastPostAt = new Date().toISOString();
      gramStatus.lastPostOk = true;
      gramStatus.lastPostError = 'none';
    },
    onError: (err) => {
      gramStatus.lastPostOk = false;
      gramStatus.lastPostError = shortError(err);
    },
  });
  stateStore.putEventDedup(eventKey, getEventTtlMin(analysis.threat_type || analysis.threatType));
}

async function handleByMode(analysis, eventKey) {
  const mode = stateStore.getPostingMode();
  const previewText = buildPreviewText(analysis);

  if (mode === 'off') {
    logger.info('Posting skipped (mode=off)', { eventKey, previewText });
    stateStore.putEventDedup(eventKey, getEventTtlMin(analysis.threat_type || analysis.threatType));
    return { posted: false, decision: 'skip: mode=off' };
  }

  if (mode === 'manual') {
    const pending = stateStore.addPending({ eventKey, analysis, previewText });
    stateStore.putEventDedup(eventKey, getEventTtlMin(analysis.threat_type || analysis.threatType));
    await bot.telegram.sendMessage(
      config.adminUserId,
      `Потрібне підтвердження #${pending.id}
${previewText}

/approve ${pending.id} або /reject ${pending.id}`,
      { disable_web_page_preview: true },
    );
    return { posted: false, decision: 'skip: mode=manual' };
  }

  console.log('[PIPE] posting attempt', { target: config.targetChatId });
  if (!config.targetChatId) {
    gramStatus.lastPostAt = new Date().toISOString();
    gramStatus.lastPostOk = false;
    gramStatus.lastPostError = 'targetChatId missing';
    return { posted: false, decision: 'skip: targetChatId missing' };
  }

  try {
    await bot.telegram.sendMessage(config.targetChatId, previewText, { disable_web_page_preview: true });
    gramStatus.lastPostAt = new Date().toISOString();
    gramStatus.lastPostOk = true;
    gramStatus.lastPostError = 'none';
    stateStore.putEventDedup(eventKey, getEventTtlMin(analysis.threat_type || analysis.threatType));
    return { posted: true, decision: 'post' };
  } catch (e) {
    gramStatus.lastPostAt = new Date().toISOString();
    gramStatus.lastPostOk = false;
    gramStatus.lastPostError = shortError(e?.response?.description || e?.message || String(e));
    return { posted: false, decision: 'error: post failed' };
  }
}


async function processItems(items) {
  let analyzed = 0;
  let posted = 0;

  for (const item of items) {
    const dedupKey = normalizeText(item.text).slice(0, 220);
    if (stateStore.isDedup(dedupKey)) continue;

    analyzed += 1;
    const analysis = await analyzeMessage({
      text: item.text,
      sourceName: item.sourceName,
      regions: config.regions,
      config,
      logger,
      llmContext: getLlmContext(),
    });

    const previewText = buildPreviewText(analysis);
    const shouldPost = Boolean(analysis.should_post ?? analysis.shouldPost);
    const decision = shouldPost ? 'post' : 'skip: should_post=false';
    console.log('[PIPE] analyzed', {
      should_post: shouldPost,
      decision,
      previewLen: (previewText || '').length,
    });

    if (!shouldPost) {
      stateStore.putDedup(dedupKey, config.dedupTtlMin);
      continue;
    }

    let finalAnalysis = { ...analysis };
    const baseKey = buildBaseEventKey(finalAnalysis);
    const prevMeta = stateStore.getEventBaseMeta(baseKey);
    if (isUpdateCompared(prevMeta, finalAnalysis)) {
      finalAnalysis = { ...finalAnalysis, isUpdate: true };
    }

    const eventKey = buildEventKey(finalAnalysis);
    if (stateStore.isEventDedup(eventKey)) {
      stateStore.putDedup(dedupKey, config.dedupTtlMin);
      continue;
    }

    const modeResult = await handleByMode(finalAnalysis, eventKey);

    stateStore.putEventBaseMeta(
      baseKey,
      { locations: finalAnalysis.locations || [], count: finalAnalysis.count ?? null },
      getEventTtlMin(finalAnalysis.threat_type || finalAnalysis.threatType),
    );

    if (modeResult.posted) posted += 1;

    stateStore.putDedup(dedupKey, config.dedupTtlMin);
  }

  return { analyzed, posted };
}


async function tickOnce(reason = 'interval') {
  gramStatus.lastTickAt = new Date().toISOString();
  gramStatus.lastTickReason = reason;

  if (!gramStatus.initialized) {
    gramStatus.lastTickError = 'GramJS is not initialized';
    return {
      fetchedTotal: 0,
      newTotal: 0,
      analyzed: 0,
      posted: 0,
      perChannelStats: {},
      reason,
      at: gramStatus.lastTickAt,
    };
  }

  if (gramStatus.isTickRunning) {
    return gramStatus.lastTickStats || {
      fetchedTotal: 0,
      newTotal: 0,
      analyzed: 0,
      posted: 0,
      perChannelStats: {},
      reason,
      at: gramStatus.lastTickAt,
    };
  }

  gramStatus.isTickRunning = true;
  try {
    const tick = await gramStatus.fetcher.tick();
    const processed = await processItems(tick.items);
    gramStatus.lastTickError = 'none';
    gramStatus.lastTickStats = {
      ...tick,
      analyzed: processed.analyzed,
      posted: processed.posted,
      reason,
      at: new Date().toISOString(),
    };
    return gramStatus.lastTickStats;
  } catch (error) {
    gramStatus.lastTickError = shortError(error?.message || error);
    logger.error('Tick failed:', error?.message || error);
    gramStatus.lastTickStats = {
      fetchedTotal: 0,
      newTotal: 0,
      analyzed: 0,
      posted: 0,
      perChannelStats: {},
      reason,
      at: new Date().toISOString(),
    };
    return gramStatus.lastTickStats;
  } finally {
    gramStatus.lastTickAt = new Date().toISOString();
    gramStatus.isTickRunning = false;
  }
}

async function startScheduler() {
  if (gramStatus.schedulerStarted) return;
  gramStatus.schedulerStarted = true;

  await tickOnce('boot');

  gramStatus.schedulerTimer = setInterval(() => {
    tickOnce('interval').catch((error) => {
      gramStatus.lastTickError = shortError(error?.message || error);
      logger.error('tickOnce interval error:', error?.message || error);
    });
  }, Math.max(5, config.fetchIntervalSec) * 1000);
}

bot.command('ping', async (ctx) => { if (!isAdmin(ctx)) return; await ctx.reply('pong'); });

bot.command('mode', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = (ctx.message?.text || '').split(/\s+/).filter(Boolean);
  if (parts.length === 1) return ctx.reply(`mode=${stateStore.getPostingMode()}`);
  const ok = stateStore.setPostingMode((parts[1] || '').toLowerCase());
  if (!ok) return ctx.reply('Невірний режим. /mode auto|manual|off');
  await ctx.reply(`mode=${stateStore.getPostingMode()}`);
});

bot.command('llm', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = (ctx.message?.text || '').split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return ctx.reply(`llmMode=${stateStore.getLlmMode()} cooldownUntil=${stateStore.getLlmCooldownUntil() || 0} lastError=${shortError(stateStore.getLlmLastError())}`);
  }
  const mode = (parts[1] || '').toLowerCase();
  const ok = stateStore.setLlmMode(mode);
  if (!ok) return ctx.reply('Невірний режим. /llm off|smart');
  await ctx.reply(`llmMode=${stateStore.getLlmMode()} cooldownUntil=${stateStore.getLlmCooldownUntil() || 0}`);
});

bot.command('approve', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = (ctx.message?.text || '').split(/\s+/)[1];
  if (!id) return ctx.reply('Вкажи id: /approve <id>');
  const pending = stateStore.getPending(id);
  if (!pending) return ctx.reply(`pending ${id} не знайдено`);
  await handleApprovedPost(pending.analysis, pending.eventKey);
  stateStore.removePending(id);
  await ctx.reply(`Публікацію ${id} відправлено.`);
});

bot.command('reject', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = (ctx.message?.text || '').split(/\s+/)[1];
  if (!id) return ctx.reply('Вкажи id: /reject <id>');
  const removed = stateStore.removePending(id);
  if (!removed) return ctx.reply(`pending ${id} не знайдено`);
  await ctx.reply(`Публікацію ${id} відхилено.`);
});

bot.command('debug', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const llm = getLlmStatus();
  const msgRows = config.sourceChannels.map((ch) => `${ch}: lastMsgId=${stateStore.getLastMsgId(ch)}`);
  await ctx.reply([
    `postingMode=${stateStore.getPostingMode()}`,
    `llmMode=${stateStore.getLlmMode()}`,
    `llmCooldownUntil=${stateStore.getLlmCooldownUntil() || 0}`,
    `llmLastError=${shortError(stateStore.getLlmLastError())}`,
    `llmActiveModel=${llm.activeModel || 'none'}`,
    `lastTickAt=${gramStatus.lastTickAt || 'never'}`,
    `lastTickReason=${gramStatus.lastTickReason || 'none'}`,
    `lastTickError=${shortError(gramStatus.lastTickError)}`,
    `lastPostAt=${gramStatus.lastPostAt || 'never'}`,
    `lastPostOk=${gramStatus.lastPostOk === null ? 'none' : String(gramStatus.lastPostOk)}`,
    `lastPostError=${shortError(gramStatus.lastPostError)}`,
    ...msgRows,
  ].join('\n'));
});

bot.command('models', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await listModels({ apiKey: config.geminiApiKey, logger });
  const llm = getLlmStatus();
  await ctx.reply([
    `activeModel=${llm.activeModel || 'none'}`,
    `last10Models=${llm.lastModels.length ? llm.lastModels.join(', ') : 'none'}`,
    `lastLlmError=${shortError(llm.lastError)}`,
  ].join('\n'));
});

bot.command('profiles', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply([
    `UAV_ONLY_SOURCES=${config.uavOnlySources.length ? config.uavOnlySources.join(', ') : 'none'}`,
    `MISSILE_ONLY_SOURCES=${config.missileOnlySources.length ? config.missileOnlySources.join(', ') : 'none'}`,
  ].join('\n'));
});

bot.command('sources', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const rows = config.sourceChannels.map((ch) => `${ch}: lastMsgId=${stateStore.getLastMsgId(ch)}`);
  await ctx.reply([
    `enabled=${gramStatus.enabled} initialized=${gramStatus.initialized}`,
    ...rows,
    `lastTickAt=${gramStatus.lastTickAt || 'never'}`,
    `lastTickReason=${gramStatus.lastTickReason || 'none'}`,
    `lastTickError=${shortError(gramStatus.lastTickError)}`,
    `lastPostAt=${gramStatus.lastPostAt || 'never'}`,
    `lastPostOk=${gramStatus.lastPostOk === null ? 'none' : String(gramStatus.lastPostOk)}`,
    `lastPostError=${shortError(gramStatus.lastPostError)}`,
    `lastTick=${gramStatus.lastTickStats ? JSON.stringify({ fetchedTotal: gramStatus.lastTickStats.fetchedTotal, newTotal: gramStatus.lastTickStats.newTotal, posted: gramStatus.lastTickStats.posted, at: gramStatus.lastTickStats.at, reason: gramStatus.lastTickStats.reason }) : 'none'}`,
    `mode=${stateStore.getPostingMode()}`,
    `llmMode=${stateStore.getLlmMode()}`,
    `pending=${stateStore.listPending().length}`,
  ].join('\n'));
});

bot.command('pull', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const stats = await tickOnce('pull');

  const pullDebug = Object.entries(stats.perChannelStats || {})
    .map(([ch, st]) => `${ch}: lastIdBefore=${st.lastIdBefore}, maxIdFetched=${st.maxIdFetched}, newCount=${st.new}`)
    .join('\n');

  const lines = [
    `pull done: fetched=${stats.fetchedTotal}, new=${stats.newTotal}, analyzed=${stats.analyzed}, posted=${stats.posted}`,
    pullDebug || 'no per-channel stats',
    `lastPostAt=${gramStatus.lastPostAt || 'never'}`,
    `lastPostOk=${gramStatus.lastPostOk === null ? 'none' : String(gramStatus.lastPostOk)}`,
    `lastPostError=${shortError(gramStatus.lastPostError)}`,
  ];
  await ctx.reply(lines.join('\n'));
});

bot.command('postlast', async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!gramStatus.initialized) return ctx.reply('GramJS is not initialized');

  const first = config.sourceChannels[0];
  const messages = await gramStatus.client.getMessages(first, { limit: 1 });
  const msg = messages?.[0];
  const text = msg?.message?.trim();
  if (!text) return ctx.reply('No text in last message');

  const analysis = await analyzeMessage({ text, sourceName: first, regions: config.regions, config, logger, llmContext: getLlmContext() });
  const eventKey = buildEventKey(analysis);
  const shouldPost = Boolean(analysis.should_post ?? analysis.shouldPost);
  const skipReason = stateStore.isEventDedup(eventKey) ? 'skip: event dedup TTL' : (shouldPost ? 'post' : 'skip: should_post=false');

  await ctx.reply([
    formatAnalysis(analysis),
    `sourceProfile=${JSON.stringify(getSourceProfile(first, config))}`,
    `eventKey=${eventKey}`,
    `decision=${skipReason}`,
    `previewText=${sanitizeOutput(buildPreviewText(analysis))}`,
  ].join('\n'));
});

bot.command('selfcheck', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const sample = 'Тепер локаційно лише залишилось 2 БпЛа. 1 в районі Бахмача ... 1 в районі Путивля ...';
  const sampleSource = config.uavOnlySources[0] || config.sourceChannels[0];
  const analysis = await analyzeMessage({ text: sample, sourceName: sampleSource, regions: config.regions, config, logger, llmContext: getLlmContext() });
  await ctx.reply([
    `sampleSource=${sampleSource}`,
    formatAnalysis(analysis),
    `eventKey=${buildEventKey(analysis)}`,
    `previewText=${sanitizeOutput(buildPreviewText(analysis))}`,
  ].join('\n'));
});

bot.command('postlast_force', async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!gramStatus.initialized) return ctx.reply('GramJS is not initialized');
  const first = config.sourceChannels[0];
  const messages = await gramStatus.client.getMessages(first, { limit: 1 });
  const msg = messages?.[0];
  const text = msg?.message?.trim();
  if (!text) return ctx.reply('No text in last message');
  const analysis = await analyzeMessage({ text, sourceName: first, regions: config.regions, config, logger, llmContext: getLlmContext() });
  await handleApprovedPost(analysis, buildEventKey(analysis));
  await ctx.reply(`Forced post sent.\n${formatAnalysis(analysis)}`);
});

await initGramIfPossible();
await bot.launch();
logger.info('Bot started');
await startScheduler();

process.once('SIGINT', () => {
  if (gramStatus.schedulerTimer) clearInterval(gramStatus.schedulerTimer);
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  if (gramStatus.schedulerTimer) clearInterval(gramStatus.schedulerTimer);
  bot.stop('SIGTERM');
});
