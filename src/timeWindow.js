function parseHHMM(value) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function isDayTime(now = new Date(), dayStart = '07:00', dayEnd = '23:00') {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = parseHHMM(dayStart);
  const end = parseHHMM(dayEnd);

  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}
