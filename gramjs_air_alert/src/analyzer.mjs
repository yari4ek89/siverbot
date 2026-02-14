import { extractDirections, extractLocations } from "./extractors.mjs";

const regionRules = {
  chernihiv: [
    /черніг/iu,
    /черниг/iu,
    /ніжин/iu,
    /бахмач/iu,
    /новгород[-\s]?сіверськ/iu,
    /прилуки/iu,
    /корюків/iu,
    /козелец/iu
  ],
  sumy: [
    /сум/iu,
    /конотоп/iu,
    /путивл/iu,
    /шостк/iu,
    /глух[іi]в/iu,
    /ромн/iu,
    /охтир/iu,
    /білопіл/iu
  ]
};

const threatRules = {
  uav: [
    /бпла/iu,
    /дрон/iu,
    /шахед/iu,
    /мопед/iu,
    /герань/iu,
    /uav/iu,
    /табун/iu,
    /рой/iu,
    /зграя/iu,
    /стадо/iu,
    /пачка/iu,
    /пакет/iu
  ],
  missile: [/ракета/iu, /ракетна\s+небезпека/iu, /пуски?/iu, /калібр/iu, /х-\d+/iu, /крилат/iu],
  ppo: [/ппо/iu, /робота\s+ппо/iu, /збито/iu, /працює\s+ппо/iu],
  aviation: [/авіа/iu, /літак/iu, /міг/iu, /су-\d+/iu]
};

const numberWords = new Map([
  ["один", 1],
  ["одна", 1],
  ["два", 2],
  ["дві", 2],
  ["три", 3],
  ["чотири", 4],
  ["пʼять", 5],
  ["п'ять", 5],
  ["шість", 6],
  ["сім", 7],
  ["вісім", 8],
  ["дев'ять", 9],
  ["десять", 10]
]);

function detectRegions(text) {
  const detected = [];

  for (const [region, regexes] of Object.entries(regionRules)) {
    if (regexes.some((re) => re.test(text))) {
      detected.push(region);
    }
  }

  return detected.sort();
}

function detectThreatType(text) {
  for (const [threatType, regexes] of Object.entries(threatRules)) {
    if (regexes.some((re) => re.test(text))) {
      return threatType;
    }
  }
  return "unknown";
}

function extractCount(text) {
  const digitMatch = text.match(/\b(\d{1,3})\b/u);
  if (digitMatch) {
    return Number.parseInt(digitMatch[1], 10);
  }

  const lowered = text.toLowerCase();
  for (const [word, number] of numberWords.entries()) {
    if (new RegExp(`\\b${word}\\b`, "iu").test(lowered)) {
      return number;
    }
  }

  return null;
}

export function analyzeMessage(text) {
  const regions = detectRegions(text);
  const threatType = detectThreatType(text);
  const locations = extractLocations(text);
  const directions = extractDirections(text);
  const count = extractCount(text);

  const shouldPost = regions.length > 0 && threatType !== "unknown";

  return {
    shouldPost,
    regions,
    threatType,
    locations,
    directions,
    count,
    rawText: text
  };
}
