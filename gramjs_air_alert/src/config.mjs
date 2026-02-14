import dotenv from "dotenv";

dotenv.config();

const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

const splitChannels = (raw) =>
  (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

export const config = {
  tgApiId: toInt(process.env.TG_API_ID, 0),
  tgApiHash: process.env.TG_API_HASH ?? "",
  tgSession: process.env.TG_SESSION ?? "",
  sourceChannels: splitChannels(process.env.SOURCE_CHANNELS),
  targetChannel: (process.env.TARGET_CHANNEL ?? "").trim(),
  fetchIntervalSec: toInt(process.env.FETCH_INTERVAL_SEC, 15),
  fetchLimit: toInt(process.env.FETCH_LIMIT, 30),
  dedupTtlSec: {
    uav: toInt(process.env.DEDUP_TTL_UAV_SEC, 1200),
    missile: toInt(process.env.DEDUP_TTL_MISSILE_SEC, 600),
    ppo: toInt(process.env.DEDUP_TTL_PPO_SEC, 900),
    aviation: toInt(process.env.DEDUP_TTL_AVIATION_SEC, 900)
  }
};

export function validateConfig() {
  const missing = [];

  if (!config.tgApiId) missing.push("TG_API_ID");
  if (!config.tgApiHash) missing.push("TG_API_HASH");
  if (!config.tgSession) missing.push("TG_SESSION");
  if (!config.targetChannel) missing.push("TARGET_CHANNEL");
  if (!config.sourceChannels.length) missing.push("SOURCE_CHANNELS");

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
