# Siverbot 24/7

Бот з офіційним polling тривог (джерело A), MTProto-читачем каналів, адмін-керуванням через Telegraf, чергою модерації та LLM-аналізом.

## Встановлення
1. Скопіюйте `.env.example` -> `.env`.
2. Заповніть ключі Telegram/alerts/LLM.
3. `npm install`
4. `npm start`

## TG_SESSION для MTProto
1. Створіть окремий тимчасовий скрипт на GramJS з `StringSession`.
2. Пройдіть логін другим акаунтом Telegram.
3. Збережіть рядок сесії у `TG_SESSION`.

## Ключові команди (owner)
- `/duty on|off`
- `/mode night|day|manual`
- `/status`
- `/mtproto` (стан підключення + причина)
- `/queue` (+ кнопки approve/reject)
- `/sources`, `/source_add`, `/source_on <id>`, `/source_off <id>`
- `/health`, `/settings`, `/set <key> <value>`

## Режими
- `manual`: автопублікації вимкнено.
- `night`: автопублікація лише офіційних тривог.
- `day`: офіційні тривоги + непідтверджені тільки при 2 незалежних джерелах, якщо увімкнено `autopost_unverified_day=true`.

## Безпека
- Жорсткий фільтр блокує координати/адреси/маршрути/прогнози часу.
- Якщо небезпечно — автопублікація заборонена, подія йде в чергу.
- LLM є primary шляхом аналізу; без ключа або при помилці — fallback на rule-based.
