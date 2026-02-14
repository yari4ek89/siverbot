import fs from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
const statePath = path.join(dataDir, "state.json");

const defaultState = {
  lastMsgIdByChannel: {},
  dedup: {},
  lastTickAt: null,
  lastTickError: null,
  lastPostedAt: null,
  lastPostError: null
};

function mergeState(raw) {
  return {
    ...defaultState,
    ...(raw ?? {}),
    lastMsgIdByChannel: { ...defaultState.lastMsgIdByChannel, ...(raw?.lastMsgIdByChannel ?? {}) },
    dedup: { ...defaultState.dedup, ...(raw?.dedup ?? {}) }
  };
}

export async function loadState() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    const content = await fs.readFile(statePath, "utf8");
    return mergeState(JSON.parse(content));
  } catch (error) {
    if (error.code === "ENOENT") {
      await saveState(defaultState);
      return { ...defaultState };
    }
    throw error;
  }
}

export async function saveState(state) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function cleanupExpiredDedup(state, nowMs) {
  for (const [key, expiresAtMs] of Object.entries(state.dedup)) {
    if (expiresAtMs <= nowMs) {
      delete state.dedup[key];
    }
  }
}
