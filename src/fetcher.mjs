function toISODate(msg) {
  const d = msg?.date;
  if (!d) return new Date().toISOString();
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'number') return new Date(d * 1000).toISOString();
  if (typeof d === 'string') {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

export async function fetchTick({ client, sourceChannels, fetchLimit, stateStore }) {
  const items = [];
  let fetchedTotal = 0;
  let newTotal = 0;

  const perChannel = {};

  for (const channel of sourceChannels) {
    let lastId = stateStore.getLastMsgId(channel) || 0;
    const latest = await client.getMessages(channel, { limit: fetchLimit });
    const arr = Array.isArray(latest) ? latest : [...latest];
    const ids = arr.map((m) => Number(m?.id || 0)).filter((x) => x > 0);
    const maxId = ids.length ? Math.max(...ids) : lastId;

    perChannel[channel] = {
      lastIdBefore: lastId,
      maxIdFetched: maxId,
      fetched: arr.length,
      new: 0,
    };

    fetchedTotal += arr.length;

    if (lastId === 0) {
      stateStore.setLastMsgId(channel, maxId);
      continue;
    }

    const newMsgs = arr.filter((m) => Number(m?.id || 0) > lastId).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    stateStore.setLastMsgId(channel, maxId);
    perChannel[channel].new = newMsgs.length;

    for (const msg of newMsgs) {
      try {
        const text = String(msg?.message || '').trim();
        if (!text) continue;

        items.push({
          sourceName: channel,
          id: Number(msg.id || 0),
          text,
          date: toISODate(msg),
        });
      } catch {
        // skip one bad message and continue
      }
    }

    newTotal += newMsgs.length;
  }

  return { items, fetchedTotal, newTotal, perChannel };
}
