const bannedWordRegex = /\b(джерело|канал|источник)\b/giu;
const usernameRegex = /@[\w\d_]+/g;

function formatRegions(regions) {
  const hasChernihiv = regions.includes("chernihiv");
  const hasSumy = regions.includes("sumy");

  if (hasChernihiv && hasSumy) return "Чернігівщині й Сумщині";
  if (hasChernihiv) return "Чернігівщині";
  return "Сумщині";
}

function firstLine(threatType, regions, isUpdate) {
  const regionLabel = formatRegions(regions);
  const prefix = isUpdate ? "Оновлення: " : "";

  if (threatType === "uav") return `${prefix}🛸 Є БПЛА по ${regionLabel}.`;
  if (threatType === "missile") return `${prefix}🚀 Ракетна небезпека по ${regionLabel}.`;
  if (threatType === "ppo") return `${prefix}🛡️ Робота ППО по ${regionLabel}.`;
  return `${prefix}✈️ Авіаційна активність по ${regionLabel}.`;
}

function secondLine({ locations, directions }) {
  if (!locations.length) {
    return "Деталей по локаціях поки немає.";
  }

  const locationPart = `Локації: ${locations.join(", ")}.`;
  if (!directions.length) {
    return locationPart;
  }

  return `${locationPart} (${directions.join("; ")})`;
}

export function sanitizePost(text) {
  return text
    .replace(usernameRegex, "")
    .replace(bannedWordRegex, "")
    .replace(/\s{2,}/g, " ")
    .replace(/ \./g, ".")
    .trim();
}

export function formatPost(analysis, { isUpdate = false } = {}) {
  const line1 = firstLine(analysis.threatType, analysis.regions, isUpdate);
  const line2 = secondLine(analysis);

  return sanitizePost(`${line1}\n${line2}`);
}
