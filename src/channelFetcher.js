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

    for (const channel of this.channelUsernames) {
      const entity = await this.client.getEntity(channel);
      const messages = await this.client.getMessages(entity, { limit: this.limit });
      const sorted = [...messages].sort((a, b) => a.id - b.id);

      let maxSeenId = this.lastMsgId.get(channel) || 0;
      for (const msg of sorted) {
        const msgId = Number(msg?.id || 0);
        if (msgId > maxSeenId) {
          maxSeenId = msgId;
        }
      }

      if (!this.lastMsgId.has(channel)) {
        if (maxSeenId > 0) {
          this.lastMsgId.set(channel, maxSeenId);
        }
        continue;
      }

      const prevLastId = this.lastMsgId.get(channel) || 0;

      for (const msg of sorted) {
        const text = String(msg?.message || '').trim();
        const msgId = Number(msg?.id || 0);
        if (!text || msgId <= prevLastId) continue;

        items.push({
          text,
          sourceName: channel,
          sourceId: String(entity?.id ?? ''),
          msgId,
          date: msg?.date || null
        });
      }

      if (maxSeenId > prevLastId) {
        this.lastMsgId.set(channel, maxSeenId);
      }
    }

    return items;
  }
}
