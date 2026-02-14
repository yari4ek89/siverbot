function normalizeLocations(locations) {
  return [...locations].map((v) => v.toLowerCase()).sort();
}

export function buildEventKey({ threatType, regions, locations, count }) {
  const regionsPart = [...regions].sort().join("+");
  const locationsPart = normalizeLocations(locations).join(",");
  const countPart = count ?? "na";
  return `${threatType}|${regionsPart}|${locationsPart}|${countPart}`;
}

export function buildSignature({ threatType, regions }) {
  return `${threatType}|${[...regions].sort().join("+")}`;
}

function parseEventKey(key) {
  const [threatType, regionsPart, locationsPart, countPart] = key.split("|");
  if (!threatType || !regionsPart) return null;
  return {
    signature: `${threatType}|${regionsPart}`,
    locations: locationsPart ? locationsPart.split(",").filter(Boolean) : [],
    count: countPart === "na" ? null : Number.parseInt(countPart, 10)
  };
}

export function shouldPostByDedup({ analysis, state, nowMs, ttlSecByType }) {
  const signature = buildSignature(analysis);
  const eventKey = buildEventKey(analysis);
  const activeUntil = state.dedup[eventKey] ?? 0;

  if (activeUntil > nowMs) {
    return { shouldPost: false, isUpdate: false, eventKey };
  }

  const currentLocSet = new Set(normalizeLocations(analysis.locations));
  const currentCount = analysis.count ?? 0;

  let isUpdate = false;

  for (const [key, expiresAt] of Object.entries(state.dedup)) {
    if (expiresAt <= nowMs) continue;
    const parsed = parseEventKey(key);
    if (!parsed || parsed.signature !== signature) continue;

    const prevLocSet = new Set(parsed.locations);
    const hasLocationExpansion = [...prevLocSet].every((loc) => currentLocSet.has(loc)) &&
      currentLocSet.size > prevLocSet.size;
    const hasCountGrowth = currentCount > (parsed.count ?? 0);

    if (hasLocationExpansion || hasCountGrowth) {
      isUpdate = true;
      break;
    }
  }

  const ttlSec = ttlSecByType[analysis.threatType] ?? 600;
  state.dedup[eventKey] = nowMs + ttlSec * 1000;

  return { shouldPost: true, isUpdate, eventKey };
}
