# Siverbot 24/7

Бот з офіційним polling тривог (джерело A) + MTProto-канали (джерело B), автопостом 24/7 для trusted джерел та safety-first фільтром.

## Встановлення
1. Скопіюйте `.env.example` -> `.env`.
2. Заповніть ключі Telegram/alerts/LLM.
3. `npm install`
4. `npm start`

## Команди owner
- `/duty on|off`
- `/mode night|day|manual`
- `/status`
- `/mtproto`
- `/focus [shahed|all]`
- `/antispam status`
- `/queue` (+ approve/reject)
- `/sources`, `/source_add`, `/source_set_level <id> A|B|C`, `/source_on <id>`, `/source_off <id>`
- `/health`, `/settings`, `/set <key> <value>`

## Логіка автопосту
- `duty_enabled=true` + mode `night/day`: автопост для trusted джерел (A/B), якщо SafetyFilter+anti-spam пройдені.
- `manual` або `duty_enabled=false`: без автопосту, події у чергу.
- Черга використовується переважно для safety-blocked або коли безпечно узагальнити не вдалось.

## FOCUS_MODE
- `shahed` (default): обробляються лише повідомлення з ключами `шахед|shahed|бпла|дрон|uav|мопед`.
- `all`: обробляються всі категорії, але safety правила незмінні.

## Safety та антиспам
- Заборонені координати/адреси/маршрути/прогнози часу — такі події не автопостяться.
- Dedup (default 20 хв), per-source cooldown (120с), global rate limit (3 пости / 5 хв).
