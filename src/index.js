import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { StateStore } from './stateStore.js';
import { normalizeText } from './normalize.js';
import { createGramClient } from './gramjsClient.js';
import { ChannelFetcher } from './channelFetcher.js';
import { analyzeMessage, detectRegionsFromRaw, detectThreatFromRaw, buildEventKey } from './analyzer.js';
import { Confirmer } from './confirmer.js';
import { postEvent, buildPreviewText } from './poster.js';
import { getLlmStatus, listModels } from './llmGemini.js';
import { getSourceProfile } from './sourceProfile.js';

const logger = createLogger(config.logLevel);
const bot = new Telegraf(config.botToken);
const stateStore = new StateStore(config.stateFile);
stateStore.loadState();

const confirmer = new Confirmer({
  confirmWindowMin: config.confirmWindowMin,
  minSourcesDay: config.minSourcesDay,
  minSourcesNight: config.minSourcesNight,
  dayStart: config.dayStart,
  dayEnd: config.dayEnd,
});

let gram = {
  enabled: true,
  initialized: false,
  client: null,
  fetcher: null,
  lastInitError: null,
};

let lastTickStats = null;
let isTickRunning = false;

function isAdmin(ctx) {
  return Number(ctx.from?.id) === config.adminUserId;
}

function shortError(message, limit = 200) {
  if (!message) return 'none';
  return String(message).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function getEventTtlMin(threatType) {
  if (threatType === 'uav') return 20;
  if (threatType === 'missile') return 10;
  if (threatType === 'air_defense') return 15;
  return config.dedupTtlMin;
}

function formatAnalysis(analysis) {
  return [
    `should_post=${analysis.should_post ?? analysis.shouldPost}`,
    `regions=${analysis.regions ?? analysis.regionHits?.join(',')}`,
    `threat_type=${analysis.threat_type ?? analysis.threatType}`,
    `confidence=${analysis.confidence}`,
    `title=${analysis.title}`,
    `summary=${analysis.summary}`,
    `reason=${analysis.reason}`,
    `count=${analysis.count ?? 'none'}`,
    `locations=${(analysis.locations || []).join(', ') || 'none'}`,
    `directions=${(analysis.directions || []).join(', ') || 'none'}`,
  ].join('\n');
}

async function initGramIfPossible() {
  try {
    gram.client = await createGramClient({
      apiId: config.tgApiId,
      apiHash: config.tgApiHash,
      sessionString: config.tgSessionString,
    });
    gram.fetcher = new ChannelFetcher(gram.client, config.sourceChannels, config.fetchLimit, stateStore, logger);
    gram.initialized = true;
    gram.lastInitError = null;
    logger.info('GramJS initialized successfully');
  } catch (error) {
    gram.initialized = false;
    gram.lastInitError = error?.message || String(error);
    logger.error('GramJS init failed:', gram.lastInitError);
  }
}

async function handleApprovedPost(analysis, eventKey) {
  await postEvent({
    bot,
    targetChatId: config.targetChatId,
    event: { analysis, sources: [] },
  });
  stateStore.putEventDedup(eventKey, getEventTtlMin(analysis.threat_type || analysis.threatType));
}

async function handleByMode(analysis, eventKey) {
  const mode = stateStore.getPostingMode();
  const previewText = buildPreviewText(analysis);

  if (mode === 'off') {
    logger.info('Posting skipped (mode=off)', { eventKey, previewText });
    stateStore.putEventDedup(eventKey, getEventTtlMin(analysis.threat_type || analysis.threatType));
    return { posted: false, mode, pendingId: null };
  }

  if (mode === 'manual') {
    const pending = stateStore.addPending({
      eventKey,
      analysis,
      previewText,
    });
    stateStore.putEventDedup(eventKey, getEventTtlMin(analysis.threat_type || analysis.threatType));

    await bot.telegram.sendMessage(
      config.adminUserId,
      `Потрібне підтвердження #${pending.id}\n${previewText}\n\n/approve ${pending.id} або /reject ${pending.id}`,
      { disable_web_page_preview: true },
    );

    return { posted: false, mode, pendingId: pending.id };
  }

  await handleApprovedPost(analysis, eventKey);
  return { posted: true, mode, pendingId: null };
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
    });

    if (!analysis.shouldPost) continue;

    const confirmation = confirmer.add({
      text: item.text,
      sourceName: item.sourceName,
      analysis,
    });

    if (!confirmation.readyToPost) continue;

    const eventKey = buildEventKey(confirmation.analysis);
    if (stateStore.isEventDedup(eventKey)) {
      logger.info('Event dedup hit, skip', { eventKey });
      continue;
    }

    const modeResult = await handleByMode(confirmation.analysis, eventKey);
    if (modeResult.posted) posted += 1;

    stateStore.putDedup(dedupKey, config.dedupTtlMin);
  }

  return { analyzed, posted };
}

async function runTick() {
  if (!gram.initialized || isTickRunning) return;
  isTickRunning = true;

  try {
    const tick = await gram.fetcher.tick();
    const processed = await processItems(tick.items);

    lastTickStats = {
      ...tick,
      analyzed: processed.analyzed,
      posted: processed.posted,
      at: new Date().toISOString(),
    };

    logger.info('Tick stats', {
      fetchedTotal: tick.fetchedTotal,
      newTotal: tick.newTotal,
      analyzed: processed.analyzed,
      posted: processed.posted,
      postingMode: stateStore.getPostingMode(),
    });
  } catch (error) {
    logger.error('Tick failed:', error?.message || error);
  } finally {
    isTickRunning = false;
  }
}

bot.command('ping', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply('pong');
});

bot.command('mode', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const text = ctx.message?.text || '';
  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return ctx.reply(`mode=${stateStore.getPostingMode()}`);
  }

  const targetMode = (parts[1] || '').toLowerCase();
  const ok = stateStore.setPostingMode(targetMode);
  if (!ok) return ctx.reply('Невірний режим. Використай: /mode auto | manual | off');

  await ctx.reply(`mode=${stateStore.getPostingMode()}`);
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

  await ctx.reply([
    `admin=${config.adminUserId}`,
    `here_chat=${ctx.chat?.id}`,
    `target=${config.targetChatId}`,
    `pid=${process.pid}`,
    `instance=${process.uptime().toFixed(0)}s`,
    `gramjs enabled=${gram.enabled}`,
    `gramjs initialized=${gram.initialized}`,
    `lastInitError=${gram.lastInitError || 'none'}`,
    `llmEnabled=${Boolean(config.geminiApiKey)}`,
    `llmActiveModel=${llm.activeModel || 'none'}`,
    `llmLastError=${shortError(llm.lastError)}`,
    `llmLastCallAt=${llm.lastCallAt || 'never'}`,
    `postingMode=${stateStore.getPostingMode()}`,
    `pendingCount=${stateStore.listPending().length}`,
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
  const llm = getLlmStatus();
  const rows = config.sourceChannels.map((ch) => `${ch}: lastMsgId=${stateStore.getLastMsgId(ch)}`);
  await ctx.reply([
    `enabled=${gram.enabled} initialized=${gram.initialized}`,
    `parsedChannels=${config.sourceChannels.join(', ')}`,
    `invalidChannels=${config.invalidSourceChannels.length ? config.invalidSourceChannels.join(', ') : 'none'}`,
    ...rows,
    `lastTick=${lastTickStats ? JSON.stringify({ fetchedTotal: lastTickStats.fetchedTotal, newTotal: lastTickStats.newTotal, posted: lastTickStats.posted, at: lastTickStats.at }) : 'none'}`,
    `lastInitError=${gram.lastInitError || 'none'}`,
    `mode=${stateStore.getPostingMode()}`,
    `pending=${stateStore.listPending().length}`,
    `llmStatus=${JSON.stringify({ enabled: Boolean(config.geminiApiKey), activeModel: llm.activeModel, lastError: shortError(llm.lastError), lastCallAt: llm.lastCallAt })}`,
  ].join('\n'));
});

bot.command('pull', async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!gram.initialized) return ctx.reply('GramJS is not initialized');

  const tick = await gram.fetcher.tick();
  const processed = await processItems(tick.items);
  lastTickStats = { ...tick, ...processed, at: new Date().toISOString() };

  const pullDebug = Object.entries(tick.perChannelStats || {})
    .map(([ch, st]) => `${ch}: lastIdBefore=${st.lastIdBefore}, maxIdFetched=${st.maxIdFetched}, newCount=${st.new}`)
    .join('\n');

  await ctx.reply([
    `pull done: fetched=${tick.fetchedTotal}, new=${tick.newTotal}, analyzed=${processed.analyzed}, posted=${processed.posted}`,
    pullDebug || 'no per-channel stats',
  ].join('\n'));
});

bot.command('postlast', async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!gram.initialized) return ctx.reply('GramJS is not initialized');

  const first = config.sourceChannels[0];
  const messages = await gram.client.getMessages(first, { limit: 1 });
  const msg = messages?.[0];
  const text = msg?.message?.trim();

  if (!text) return ctx.reply('No text in last message');

  const analysis = await analyzeMessage({
    text,
    sourceName: first,
    regions: config.regions,
    config,
    logger,
  });

  const detectedRegionsFromRaw = detectRegionsFromRaw(text);
  const detectedThreatFromRaw = detectThreatFromRaw(text);
  const sourceProfile = getSourceProfile(first, config);

  const previewText = buildPreviewText(analysis);

  await ctx.reply([
    formatAnalysis(analysis),
    `detectedRegionsFromRaw=${detectedRegionsFromRaw.join(',')}`,
    `detectedThreatFromRaw=${detectedThreatFromRaw}`,
    `sourceProfile=${JSON.stringify(sourceProfile)}`,
    `eventKey=${buildEventKey(analysis)}`,
    `previewText=${previewText}`,
  ].join('\n'));
});

bot.command('selfcheck', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const sample = 'Тепер локаційно лише залишилось 2 БпЛа. 1 в районі Бахмача ... 1 в районі Путивля ...';
  const sampleSource = config.uavOnlySources[0] || config.sourceChannels[0];

  const analysis = await analyzeMessage({
    text: sample,
    sourceName: sampleSource,
    regions: config.regions,
    config,
    logger,
  });

  await ctx.reply([
    `sampleSource=${sampleSource}`,
    formatAnalysis(analysis),
    `detectedRegionsFromRaw=${detectRegionsFromRaw(sample).join(',')}`,
    `detectedThreatFromRaw=${detectThreatFromRaw(sample)}`,
    `sourceProfile=${JSON.stringify(getSourceProfile(sampleSource, config))}`,
    `eventKey=${buildEventKey(analysis)}`,
    `previewText=${buildPreviewText(analysis)}`,
  ].join('\n'));
});

bot.command('postlast_force', async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!gram.initialized) return ctx.reply('GramJS is not initialized');

  const first = config.sourceChannels[0];
  const messages = await gram.client.getMessages(first, { limit: 1 });
  const msg = messages?.[0];
  const text = msg?.message?.trim();

  if (!text) return ctx.reply('No text in last message');

  const analysis = await analyzeMessage({
    text,
    sourceName: first,
    regions: config.regions,
    config,
    logger,
  });

  await postEvent({
    bot,
    targetChatId: config.targetChatId,
    event: { analysis, sources: [first], text },
  });

  await ctx.reply(`Forced post sent.\n${formatAnalysis(analysis)}`);
});

await initGramIfPossible();
await bot.launch();
logger.info('Bot started');

setInterval(() => {
  runTick().catch((error) => logger.error('runTick interval error:', error?.message || error));
}, Math.max(5, config.fetchIntervalSec) * 1000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
