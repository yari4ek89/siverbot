import { analyzeMessage } from "./analyzer.mjs";
import { config, validateConfig } from "./config.mjs";
import { shouldPostByDedup } from "./dedup.mjs";
import { fetchNewMessages } from "./fetcher.mjs";
import { formatPost } from "./formatter.mjs";
import { createGramJsClient, resolveEntity } from "./gramjsClient.mjs";
import { cleanupExpiredDedup, loadState, saveState } from "./stateStore.mjs";

let client;
let state;

function nowIso() {
  return new Date().toISOString();
}

async function postToTarget(text) {
  try {
    await client.sendMessage(config.targetChannel, { message: text });
    state.lastPostedAt = nowIso();
    state.lastPostError = null;
    return true;
  } catch (error) {
    state.lastPostError = `${error?.message ?? error}`;
    return false;
  }
}

export async function tickOnce() {
  const nowMs = Date.now();
  state.lastTickAt = nowIso();
  state.lastTickError = null;
  cleanupExpiredDedup(state, nowMs);

  const counters = {
    fetchedTotal: 0,
    newTotal: 0,
    analyzed: 0,
    posted: 0,
    skippedDedup: 0,
    skippedNoMatch: 0
  };

  try {
    const fetched = await fetchNewMessages({
      client,
      channels: config.sourceChannels,
      state,
      fetchLimit: config.fetchLimit
    });

    counters.fetchedTotal = fetched.fetchedTotal;
    counters.newTotal = fetched.newTotal;

    for (const msg of fetched.messages) {
      const analysis = analyzeMessage(msg.text);
      counters.analyzed += 1;

      if (!analysis.shouldPost) {
        counters.skippedNoMatch += 1;
        continue;
      }

      const dedupDecision = shouldPostByDedup({
        analysis,
        state,
        nowMs,
        ttlSecByType: config.dedupTtlSec
      });

      if (!dedupDecision.shouldPost) {
        counters.skippedDedup += 1;
        continue;
      }

      const postText = formatPost(analysis, { isUpdate: dedupDecision.isUpdate });
      const posted = await postToTarget(postText);
      if (posted) counters.posted += 1;
    }
  } catch (error) {
    state.lastTickError = `${error?.message ?? error}`;
  } finally {
    await saveState(state);
    console.log(
      `[tick] fetchedTotal=${counters.fetchedTotal} newTotal=${counters.newTotal} analyzed=${counters.analyzed} posted=${counters.posted} skippedDedup=${counters.skippedDedup} skippedNoMatch=${counters.skippedNoMatch}`
    );
  }
}

async function main() {
  validateConfig();

  state = await loadState();
  client = await createGramJsClient({
    apiId: config.tgApiId,
    apiHash: config.tgApiHash,
    session: config.tgSession
  });

  await resolveEntity(client, config.targetChannel);
  for (const source of config.sourceChannels) {
    await resolveEntity(client, source);
  }

  await tickOnce();
  setInterval(() => {
    tickOnce().catch((error) => {
      console.error("tickOnce fatal", error);
    });
  }, config.fetchIntervalSec * 1000);
}

main().catch((error) => {
  console.error("Startup failed:", error);
  process.exitCode = 1;
});
