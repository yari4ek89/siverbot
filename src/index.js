import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { StateStore } from './stateStore.js';
import { normalizeText } from './normalize.js';
import { createGramClient } from './gramjsClient.js';
import { ChannelFetcher } from './channelFetcher.js';
import { analyzeMessage } from './analyzer.js';
import { Confirmer } from './confirmer.js';
import { postEvent } from './poster.js';

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

    await postEvent({
      bot,
      targetChatId: config.targetChatId,
      event: confirmation,
    });
    stateStore.putDedup(dedupKey, config.dedupTtlMin);
    posted += 1;
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

bot.command('debug', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply([
    `admin=${config.adminUserId}`,
    `here_chat=${ctx.chat?.id}`,
    `target=${config.targetChatId}`,
    `pid=${process.pid}`,
    `instance=${process.uptime().toFixed(0)}s`,
    `gramjs enabled=${gram.enabled}`,
    `gramjs initialized=${gram.initialized}`,
    `lastInitError=${gram.lastInitError || 'none'}`,
  ].join('\n'));
});

bot.command('sources', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const rows = config.sourceChannels.map((ch) => `${ch}: lastMsgId=${stateStore.getLastMsgId(ch)}`);
  await ctx.reply([
    `enabled=${gram.enabled} initialized=${gram.initialized}`,
    `channels=${config.sourceChannels.join(', ')}`,
    ...rows,
    `lastTick=${lastTickStats ? JSON.stringify({ fetchedTotal: lastTickStats.fetchedTotal, newTotal: lastTickStats.newTotal, posted: lastTickStats.posted, at: lastTickStats.at }) : 'none'}`,
    `lastInitError=${gram.lastInitError || 'none'}`,
  ].join('\n'));
});

bot.command('pull', async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!gram.initialized) return ctx.reply('GramJS is not initialized');

  const tick = await gram.fetcher.tick();
  const processed = await processItems(tick.items);
  lastTickStats = { ...tick, ...processed, at: new Date().toISOString() };

  await ctx.reply(`pull done: fetched=${tick.fetchedTotal}, new=${tick.newTotal}, analyzed=${processed.analyzed}, posted=${processed.posted}`);
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

  if (!analysis.shouldPost) {
    return ctx.reply(`Not posted. reason=${analysis.reason}\nsummary=${analysis.summary}`);
  }

  await postEvent({
    bot,
    targetChatId: config.targetChatId,
    event: { analysis, sources: [first], text },
    testTag: '[TEST] ',
  });

  await ctx.reply('Posted test message to target chat');
});

await initGramIfPossible();
await bot.launch();
logger.info('Bot started');

setInterval(() => {
  runTick().catch((error) => logger.error('runTick interval error:', error?.message || error));
}, Math.max(5, config.fetchIntervalSec) * 1000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
