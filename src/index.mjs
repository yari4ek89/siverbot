import 'dotenv/config';
import { createGramClient } from './gramjsClient.mjs';
import { StateStore } from './stateStore.mjs';
import { fetchTick } from './fetcher.mjs';
import { analyzeText, buildEventKey, buildBaseKey, isUpdate } from './analyzer.mjs';
import { buildPostText } from './formatter.mjs';

const config = {
  apiId: Number(process.env.TG_API_ID || 0),
  apiHash: process.env.TG_API_HASH || '',
  session: process.env.TG_SESSION || '',
  sourceChannels: (process.env.SOURCE_CHANNELS || '').split(',').map((x) => x.trim()).filter(Boolean),
  targetChannel: (process.env.TARGET_CHANNEL || '').trim(),
  fetchIntervalSec: Math.max(5, Number(process.env.FETCH_INTERVAL_SEC || 15)),
  fetchLimit: Math.max(1, Number(process.env.FETCH_LIMIT || 30)),
  ttlByType: {
    uav: Math.max(1, Number(process.env.DEDUP_TTL_UAV_SEC || 1200)),
    missile: Math.max(1, Number(process.env.DEDUP_TTL_MISSILE_SEC || 600)),
    ppo: Math.max(1, Number(process.env.DEDUP_TTL_PPO_SEC || 900)),
    aviation: Math.max(1, Number(process.env.DEDUP_TTL_AVIATION_SEC || 900)),
    unknown: 900,
  },
  stateFile: process.env.STATE_FILE || 'data/state.json',
};

if (!config.apiId || !config.apiHash || !config.session) {
  console.error('Missing TG_API_ID/TG_API_HASH/TG_SESSION');
  process.exit(1);
}
if (!config.sourceChannels.length) {
  console.error('SOURCE_CHANNELS is empty');
  process.exit(1);
}

const stateStore = new StateStore(config.stateFile);
stateStore.load();

const status = {
  lastTickAt: stateStore.state.lastTickAt,
  lastTickError: stateStore.state.lastTickError,
  lastPostedAt: stateStore.state.lastPostedAt,
  lastPostError: stateStore.state.lastPostError,
  schedulerStarted: false,
  runningTick: false,
};

function ttlFor(threatType) {
  return config.ttlByType[threatType] || 900;
}

async function processNewItems(client, items) {
  const stats = { analyzed: 0, posted: 0 };

  for (const item of items) {
    stats.analyzed += 1;

    const r = analyzeText(item.text, { source: item.sourceName });
    const previewText = buildPostText(r, { isUpdate: false });
    const decision = r.should_post ? 'post' : 'skip';

    console.log('[PIPE] analyzed', {
      channel: item.sourceName,
      should_post: r.should_post,
      decision,
      previewLen: (previewText || '').length,
    });

    if (!r.should_post) continue;

    const baseKey = buildBaseKey(r);
    const prevMeta = stateStore.getBaseMeta(baseKey);
    const update = isUpdate(prevMeta, r);
    const finalText = buildPostText(r, { isUpdate: update });

    const eventKey = buildEventKey(r);
    if (stateStore.isDedup(eventKey)) continue;

    console.log('[PIPE] posting attempt', { target: config.targetChannel });

    const now = new Date().toISOString();
    if (!config.targetChannel) {
      status.lastPostedAt = now;
      status.lastPostError = 'targetChatId missing';
      stateStore.setPostStatus({ at: now, error: status.lastPostError });
      continue;
    }

    try {
      await client.sendMessage(config.targetChannel, { message: finalText });
      stats.posted += 1;
      status.lastPostedAt = now;
      status.lastPostError = 'none';
      stateStore.putDedup(eventKey, ttlFor(r.threat_type));
      stateStore.setBaseMeta(baseKey, { locations: r.locations, count: r.count }, ttlFor(r.threat_type));
      stateStore.setPostStatus({ at: now, error: 'none' });
      console.log('[POST] ok', { target: config.targetChannel, eventKey });
    } catch (e) {
      const err = e?.response?.description || e?.message || String(e);
      status.lastPostedAt = now;
      status.lastPostError = err;
      stateStore.setPostStatus({ at: now, error: err });
      console.error('[POST] fail', err);
    }
  }

  return stats;
}

async function tickOnce(client, reason = 'interval') {
  status.lastTickAt = new Date().toISOString();
  status.lastTickError = 'none';
  stateStore.setTickStatus({ at: status.lastTickAt, error: 'none' });

  if (status.runningTick) return null;
  status.runningTick = true;

  try {
    const tick = await fetchTick({
      client,
      sourceChannels: config.sourceChannels,
      fetchLimit: config.fetchLimit,
      stateStore,
    });

    const processed = await processNewItems(client, tick.items);
    const line = `[TICK:${reason}] fetched=${tick.fetchedTotal} new=${tick.newTotal} analyzed=${processed.analyzed} posted=${processed.posted}`;
    console.log(line);

    return { ...tick, ...processed, reason };
  } catch (e) {
    const err = e?.message || String(e);
    status.lastTickError = err;
    stateStore.setTickStatus({ at: status.lastTickAt, error: err });
    console.error('[TICK] error:', err);
    return null;
  } finally {
    stateStore.save();
    status.runningTick = false;
  }
}

async function startScheduler(client) {
  if (status.schedulerStarted) return;
  status.schedulerStarted = true;

  await tickOnce(client, 'boot');
  setInterval(() => {
    tickOnce(client, 'interval').catch((e) => console.error('[SCHED] tick error', e?.message || String(e)));
  }, config.fetchIntervalSec * 1000);
}

async function main() {
  console.log('[BOOT] Connecting GramJS...');
  const client = await createGramClient({
    apiId: config.apiId,
    apiHash: config.apiHash,
    session: config.session,
  });
  console.log('[BOOT] Connected as user session.');

  await startScheduler(client);
}

main().catch((e) => {
  console.error('[FATAL]', e?.message || String(e));
  process.exit(1);
});
