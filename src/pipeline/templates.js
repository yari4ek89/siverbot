export const uaMode = { night: 'ніч', day: 'день', manual: 'ручний' };

export const alertOn = (districts) => `🚨 Тривога: ${districts.join(', ')}`;
export const alertOff = (districts) => `✅ Відбій: ${districts.join(', ')}`;
export const dutyOn = (mode) => `🟢 Бот заступив на чергування. Режим: ${uaMode[mode] || mode}.`;
export const dutyOff = () => '🔴 Чергування вимкнено. Повідомлення публікуються вручну.';
export const unverified = (a, b, hhmm) => `⚠️ НЕПІДТВЕРДЖЕНО: є повідомлення про подію в області.\nДжерела: ${a}, ${b}\nЧас: ${hhmm}\nОчікуємо підтвердження.`;
