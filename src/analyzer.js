import { analyzeWithGemini, getLlmStatus } from './llmGemini.js';
import { normalizeText } from './normalize.js';
import { getSourceProfile } from './sourceProfile.js';

const KEYWORDS = {
  uav: ['бпла', 'бплa', 'дрон', 'дрони', 'шахед', 'shahed', 'мопед', 'герань', 'герaнь'],
  missile: ['ракета', 'ракетна', 'ракетн', 'ракетна небезпека', 'крилата', 'крылат', 'баллист', 'баліст', 'пуск', 'зліт', 'злет'],
  aviation: ['авіа', 'авиа', 'літак', 'самолёт', 'стратегічна', 'стратегическая', 'тушка', 'ту-', 'міг', 'mig', 'су-'],
  air_defense: ['пво', 'ппо', 'зрк', 'с-300', 'с-400', 'патриот', 'patriot'],
};

const CHERNIHIV_PATTERNS = ['черніг', 'черниг', 'чернігівщ', 'черниговск', 'ніжин', 'нежин', 'прилук', 'бахмач', 'корюків', 'новгород сівер', 'новгород-сівер', 'сіверщина'];
const SUMY_PATTERNS = ['сум', 'сумщ', 'сумська', 'суми', 'конотоп', 'шостк', 'охтирк', 'глухів', 'ромн'];
const SUMY_TOPONYMS = ['вакалівщина', 'вакаливщина', 'vakalyvshchyna', 'vakalivshchyna'];

function shortError(message, limit = 200) {
  if (!message) return 'невідома помилка';
  return String(message).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function detectRegions(textNorm) {
  const hitsC = CHERNIHIV_PATTERNS.some((p) => textNorm.includes(p));
  const hitsS = SUMY_PATTERNS.some((p) => textNorm.includes(p)) || SUMY_TOPONYMS.some((p) => textNorm.includes(p));

  if (hitsC && hitsS) return ['both'];
  if (hitsC) return ['chernihiv'];
  if (hitsS) return ['sumy'];
  return ['none'];
}

function detectThreatType(textNorm) {
  if (KEYWORDS.uav.some((k) => textNorm.includes(k))) return 'uav';
  if (KEYWORDS.missile.some((k) => textNorm.includes(k))) return 'missile';
  if (KEYWORDS.aviation.some((k) => textNorm.includes(k))) return 'aviation';
  if (KEYWORDS.air_defense.some((k) => textNorm.includes(k))) return 'air_defense';
  return 'unknown';
}

function regionLabel(regionHits) {
  if (regionHits.includes('both')) return 'Чернігівщина + Сумщина';
  if (regionHits.includes('chernihiv')) return 'Чернігівщина';
  if (regionHits.includes('sumy')) return 'Сумщина';
  return 'Регіон не визначено';
}

function titleByThreat(threatType, regionHits) {
  const region = regionLabel(regionHits);
  const map = {
    uav: `БПЛА: ${region}`,
    missile: `Ракетна небезпека: ${region}`,
    aviation: `Авіаційна активність: ${region}`,
    air_defense: `Активність ППО: ${region}`,
    unknown: `Повітряна загроза: ${region}`,
  };
  return map[threatType] || map.unknown;
}

function summaryByThreat(threatType, regionHits) {
  const region = regionLabel(regionHits);
  const map = {
    uav: `За повідомленнями моніторингових каналів, зафіксовано повітряну загрозу із застосуванням БПЛА у межах регіону ${region}. Подано лише факт публікації без напрямків і прогнозів.`,
    missile: `За повідомленнями моніторингових каналів, оприлюднено факт ракетної небезпеки для регіону ${region}. Публікація містить коротку безпечну сводку без координат.`,
    aviation: `За повідомленнями моніторингових каналів, є ознаки авіаційної загрози для регіону ${region}. Подано стислу фактологічну інформацію без прогнозів.`,
    air_defense: `За повідомленнями моніторингових каналів, згадується повітряна небезпека в контексті роботи ППО у регіоні ${region}. Без координат і маршрутів.`,
    unknown: `Зафіксовано повідомлення про повітряну небезпеку для регіону ${region}. Подано лише факт публікації з відкритих джерел.`,
  };
  return map[threatType] || map.unknown;
}

function fallback({ text, sourceName, config, llmError = null }) {
  const textNorm = normalizeText(text);
  const regionHits = detectRegions(textNorm);
  let threatType = detectThreatType(textNorm);
  const profile = getSourceProfile(sourceName, config);

  if (threatType !== 'unknown') {
    const shouldPost = !regionHits.includes('none');
    return {
      shouldPost,
      regionHits,
      threatType,
      confidence: shouldPost ? 0.5 : 0.1,
      title: titleByThreat(threatType, regionHits),
      summary: shouldPost
        ? summaryByThreat(threatType, regionHits)
        : 'Повідомлення не відповідає фільтру повітряної небезпеки для Чернігівщини/Сумщини.',
      reason: `LLM error: ${shortError(llmError || 'недоступний')}`,
      language: 'uk',
    };
  }

  if (profile.allowLocationOnly && !regionHits.includes('none')) {
    threatType = profile.defaultThreatType;
    return {
      shouldPost: true,
      regionHits,
      threatType,
      confidence: 0.65,
      title: titleByThreat(threatType, regionHits),
      summary: summaryByThreat(threatType, regionHits),
      reason: 'Канал БПЛА-радар: локація трактується як повідомлення про загрозу з повітря.',
      language: 'uk',
    };
  }

  return {
    shouldPost: false,
    regionHits,
    threatType: 'unknown',
    confidence: 0.1,
    title: titleByThreat('unknown', regionHits),
    summary: 'Повідомлення не відповідає фільтру повітряної небезпеки для Чернігівщини/Сумщини.',
    reason: `LLM error: ${shortError(llmError || 'недоступний')}`,
    language: 'uk',
  };
}

export async function analyzeMessage({ text, sourceName, regions, config, logger }) {
  const profile = getSourceProfile(sourceName, config);
  const prompt = `Ти класифікатор OSINT-повідомлень про повітряні загрози. Поверни СУВОРО JSON за схемою:
{
  "should_post": boolean,
  "regions": ["chernihiv"|"sumy"|"both"|"none"],
  "threat_type": "uav"|"missile"|"aviation"|"air_defense"|"unknown",
  "confidence": number,
  "title": string,
  "summary": string,
  "reason": string
}
Правила:
- Публікувати лише повітряні загрози (БПЛА/ракети/авіація/ППО) для Чернігівщини та/або Сумщини.
- Якщо згадана лише одна область, вкажи тільки її, не "both".
- Джерело: ${sourceName}. Профіль джерела: defaultThreatType=${profile.defaultThreatType}, allowLocationOnly=${profile.allowLocationOnly}.
- Якщо джерело UAV-радар, короткі повідомлення з локацією можуть означати БПЛА.
- Не вигадуй загрозу, якщо джерело не має профілю UAV_ONLY або MISSILE_ONLY.
- Заборонено координати, напрямки польоту, цілі, прогнози часу/ударів.
- Усе поверни українською мовою.
- Якщо невпевнено, should_post=false.
Дозволені регіони: ${regions.join(',')}
Текст повідомлення:\n${text}`;

  try {
    const parsed = await analyzeWithGemini({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      text: prompt,
      timeoutMs: config.llmTimeoutMs,
      logger,
    });

    const regionHits = Array.isArray(parsed.regions) && parsed.regions.length ? parsed.regions : ['none'];
    const threatType = parsed.threat_type || 'unknown';
    const shouldPost = Boolean(parsed.should_post) && threatType !== 'unknown' && !regionHits.includes('none');

    return {
      shouldPost,
      regionHits,
      threatType,
      confidence: Number(parsed.confidence ?? 0),
      title: parsed.title || titleByThreat(threatType, regionHits),
      summary: parsed.summary || summaryByThreat(threatType, regionHits),
      reason: parsed.reason || 'Класифікація виконана LLM',
      language: 'uk',
    };
  } catch (error) {
    const llm = getLlmStatus();
    const modelInfo = llm.lastTriedModel ? ` (модель=${llm.lastTriedModel})` : '';
    return fallback({ text, sourceName, config, llmError: `${error?.message || 'невідома помилка'}${modelInfo}` });
  }
}
