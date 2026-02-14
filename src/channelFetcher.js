function toText(value) {
  return String(value || '').trim();
}

export class ChannelFetcher {
  constructor(client, channelUsernames = [], limit = 20) {
    this.client = client;
    this.channelUsernames = channelUsernames;
    this.limit = limit;
    this.lastMsgId = new Map();

    this.lastTickAt = null;
    this.lastTickFetchedCount = 0;
    this.lastTickNewCount = 0;
    this.lastError = null;
  }

  getLastMsgIdMap() {
    return new Map(this.lastMsgId);
  }

  getDiagnostics() {
    return {
      lastTickAt: this.lastTickAt,
      lastTickFetchedCount: this.lastTickFetchedCount,
      lastTickNewCount: this.lastTickNewCount,
      lastError: this.lastError
    };
  }

  async tick() {
    const items = [];
    const perChannel = [];
    let fetchedCount = 0;

    this.lastTickAt = new Date();
    this.lastError = null;

    try {
      for (const channel of this.channelUsernames) {
        const entity = await this.client.getEntity(channel);
        const messages = await this.client.getMessages(entity, { limit: this.limit });
        const sorted = [...messages].sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));

        fetchedCount += sorted.length;

        const lastIdBefore = this.lastMsgId.get(channel) || 0;
        let maxSeenId = lastIdBefore;

        for (const msg of sorted) {
          const msgId = Number(msg?.id || 0);
          if (msgId > maxSeenId) {
            maxSeenId = msgId;
          }
        }

        let channelNew = 0;

        if (!this.lastMsgId.has(channel)) {
          if (maxSeenId > 0) {
            this.lastMsgId.set(channel, maxSeenId);
          }
          perChannel.push({ channel, fetched: sorted.length, maxId: maxSeenId, lastIdBefore, newCount: 0 });
          continue;
        }

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

      this.lastTickFetchedCount = fetchedCount;
      this.lastTickNewCount = items.length;

      return { items, fetchedCount, newCount: items.length, perChannel };
    } catch (error) {
      this.lastTickFetchedCount = fetchedCount;
      this.lastTickNewCount = items.length;
      this.lastError = error?.message || String(error);
      throw error;
    }
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
