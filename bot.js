import 'dotenv/config';
import fs from 'node:fs';

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHANNEL = process.env.TG_CHANNEL;

const ALERTS_URL = process.env.ALERTS_URL;
const ALERTS_TOKEN = process.env.ALERTS_TOKEN;

const ALERTS_AUTH_HEADER = process.env.ALERTS_AUTH_HEADER || 'Authorization';
const ALERTS_AUTH_PREFIX = process.env.ALERTS_AUTH_PREFIX || 'Bearer';

const POLL_SECONDS = Number(process.env.POLL_SECONDS || 30);
const CONFIRM_COUNT = Number(process.env.CONFIRM_COUNT || 2);
const COOLDOWN_SECONDS = Number(process.env.COOLDOWN_SECONDS || 60);

const UID_OFFSET = Number(process.env.UID_OFFSET || 0);
const ACTIVE_SYMBOLS = new Set((process.env.ACTIVE_SYMBOLS || 'A').split(',').map(s => s.trim()).filter(Boolean));

const STATE_FILE = 'state.json';
const DISTRICTS_FILE = 'districts.json';

if (!TG_TOKEN || !TG_CHANNEL || !ALERTS_URL || !ALERTS_TOKEN) {
    console.error('Missing env vars. Need TG_BOT_TOKEN, TG_CHANNEL, ALERTS_URL, ALERTS_TOKEN');
    process.exit(1);
}

function loadDistricts() {
    if (!fs.existsSync(DISTRICTS_FILE)) {
        console.error(`Missing ${DISTRICTS_FILE}. Create it with [{uid,name}, ...].`);
        process.exit(1);
    }
    const raw = fs.readFileSync(DISTRICTS_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) {
        console.error(`${DISTRICTS_FILE} must be a non-empty array.`);
        process.exit(1);
    }
    // normalize
    return arr.map(x => ({
        uid: Number(x.uid),
        name: String(x.name || '').trim()
    })).filter(x => Number.isFinite(x.uid) && x.uid >= 0 && x.name.length > 0);
}

const DISTRICTS = loadDistricts();

function nowHHMM() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function loadState() {
    if (!fs.existsSync(STATE_FILE)) {
        return { prev: {}, pending: {}, lastSentAt: {} };
    }
    try {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const s = JSON.parse(raw);
        return {
            prev: s.prev || {},
            pending: s.pending || {},
            lastSentAt: s.lastSentAt || {}
        };
    } catch {
        return { prev: {}, pending: {}, lastSentAt: {} };
    }
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

async function tgSend(text) {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TG_CHANNEL,
            text,
            disable_web_page_preview: true
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        console.error('Telegram send error:', data?.description || res.status);
    }
}

function getCharByUid(bigString, uid) {
    const idx = uid + UID_OFFSET;
    if (idx < 0 || idx >= bigString.length) return null;
    return bigString[idx];
}

function isActiveChar(ch) {
    if (!ch) return false;
    return ACTIVE_SYMBOLS.has(ch);
}

async function fetchBigString() {
    const headers = { 'Accept': '*/*' };

    // token header
    if (ALERTS_AUTH_HEADER.toLowerCase() === 'authorization') {
        headers[ALERTS_AUTH_HEADER] = `${ALERTS_AUTH_PREFIX} ${ALERTS_TOKEN}`.trim();
    } else {
        headers[ALERTS_AUTH_HEADER] = ALERTS_TOKEN;
    }

    const res = await fetch(ALERTS_URL, { headers });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`alerts api ${res.status}: ${t.slice(0, 200)}`);
    }

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        const j = await res.json();
        // возможные формы: строка, {data:"..."}, {alerts:"..."}, {value:"..."}
        if (typeof j === 'string') return j;
        for (const key of ['data', 'alerts', 'value', 'result']) {
            if (typeof j?.[key] === 'string') return j[key];
        }
        // если внезапно пришёл массив/объект — это не наш формат
        throw new Error('Unexpected JSON format from alerts api (expected big string).');
    }

    return await res.text();
}

function cooldownPassed(key) {
    const last = Number(state.lastSentAt[key] || 0);
    const now = Date.now();
    return (now - last) >= COOLDOWN_SECONDS * 1000;
}

function markSent(keys) {
    const now = Date.now();
    for (const k of keys) state.lastSentAt[k] = now;
}

function keyFor(uid) {
    return String(uid);
}

async function tick() {
    try {
        const big = await fetchBigString();

        const turnedOn = [];
        const turnedOff = [];

        for (const d of DISTRICTS) {
            const k = keyFor(d.uid);
            const ch = getCharByUid(big, d.uid);
            const current = isActiveChar(ch); // true/false

            const prev = state.prev[k];
            const pending = state.pending[k]; // { value: true/false, count: n } или undefined

            // Инициализация: первый раз просто запоминаем
            if (typeof prev !== 'boolean') {
                state.prev[k] = current;
                state.pending[k] = undefined;
                continue;
            }

            if (current === prev) {
                // всё стабильно — сбрасываем ожидание
                state.pending[k] = undefined;
                continue;
            }

            // Изменение увидели: подтверждаем N раз
            if (!pending || typeof pending.value !== 'boolean' || pending.value !== current) {
                state.pending[k] = { value: current, count: 1 };
                continue;
            }

            // pending.value === current
            pending.count += 1;
            state.pending[k] = pending;

            if (pending.count < CONFIRM_COUNT) continue;

            // подтверждено
            state.prev[k] = current;
            state.pending[k] = undefined;

            // кулдаун, чтобы не заспамить при дрожании
            if (!cooldownPassed(k)) continue;

            if (current) turnedOn.push(d.name);
            else turnedOff.push(d.name);

            markSent([k]);
        }

        // Группируем в один пост
        const time = nowHHMM();
        if (turnedOn.length) {
            await tgSend(`🛑 Тривога: ${turnedOn.join(', ')}`);
        }
        if (turnedOff.length) {
            await tgSend(`✅ Відбій: ${turnedOff.join(', ')}`);
        }

        saveState(state);
    } catch (e) {
        console.error('Tick error:', e.message);
    }
}

console.log(`Bot started. Poll every ${POLL_SECONDS}s. Districts: ${DISTRICTS.length}`);
await tick();
setInterval(tick, POLL_SECONDS * 1000);
