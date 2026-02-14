function toText(value) {
  return String(value || '').trim();
}

export class ChannelFetcher {
  constructor(client, channelUsernames = [], limit = 20) {
    this.client = client;
    this.channelUsernames = channelUsernames;
    this.limit = limit;
    this.lastMsgId = new Map();
  }

  getLastMsgIdMap() {
    return new Map(this.lastMsgId);
  }

  async tick() {
    const items = [];
    let fetchedCount = 0;
    const perChannel = [];

    for (const channel of this.channelUsernames) {
      const entity = await this.client.getEntity(channel);
      const messages = await this.client.getMessages(entity, { limit: this.limit });
      const sorted = [...messages].sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));

      fetchedCount += sorted.length;

      const lastIdBefore = this.lastMsgId.get(channel);
      let maxSeenId = Number(lastIdBefore || 0);

      for (const msg of sorted) {
        const msgId = Number(msg?.id || 0);
        if (msgId > maxSeenId) maxSeenId = msgId;
      }

      // First tick for channel: set baseline and skip history
      if (typeof lastIdBefore !== 'number') {
        if (maxSeenId > 0) this.lastMsgId.set(channel, maxSeenId);
        perChannel.push({ channel, fetched: sorted.length, maxId: maxSeenId, lastIdBefore: 0, newCount: 0 });
        continue;
      }

      let channelNew = 0;

      for (const msg of sorted) {
        const text = toText(msg?.message);
        const msgId = Number(msg?.id || 0);
        if (!text || msgId <= lastIdBefore) continue;

        channelNew += 1;
        items.push({
          text,
          sourceName: channel,
          sourceId: String(entity?.id ?? ''),
          msgId,
          date: msg?.date || null
        });
      }

      if (maxSeenId > lastIdBefore) {
        this.lastMsgId.set(channel, maxSeenId);
      }

      perChannel.push({ channel, fetched: sorted.length, maxId: maxSeenId, lastIdBefore, newCount: channelNew });
    }

    return { items, fetchedCount, perChannel };
  }

  async getLatestFromChannel(channel) {
    const entity = await this.client.getEntity(channel);
    const messages = await this.client.getMessages(entity, { limit: 1 });
    const msg = messages?.[0];
    if (!msg) return null;

    return {
      text: toText(msg?.message),
      sourceName: channel,
      sourceId: String(entity?.id ?? ''),
      msgId: Number(msg?.id || 0),
      date: msg?.date || null
    };
  }
}
