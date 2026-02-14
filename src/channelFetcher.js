export class ChannelFetcher {
  constructor(client, channels, limit, stateStore, logger) {
    this.client = client;
    this.channels = channels;
    this.limit = limit;
    this.stateStore = stateStore;
    this.logger = logger;
    this.firstTickDone = false;
  }

  async tick() {
    const items = [];
    const perChannelStats = {};
    let fetchedTotal = 0;

    for (const channel of this.channels) {
      perChannelStats[channel] = { fetched: 0, new: 0, lastMsgId: this.stateStore.getLastMsgId(channel) };
      try {
        const messages = await this.client.getMessages(channel, { limit: this.limit });
        const sorted = [...messages].sort((a, b) => a.id - b.id);
        fetchedTotal += sorted.length;
        perChannelStats[channel].fetched = sorted.length;

        const maxId = sorted.length ? sorted[sorted.length - 1].id : this.stateStore.getLastMsgId(channel);
        const knownLast = this.stateStore.getLastMsgId(channel);

        if (!this.firstTickDone && knownLast === 0) {
          this.stateStore.setLastMsgId(channel, maxId || 0);
          perChannelStats[channel].lastMsgId = maxId || 0;
          continue;
        }

        for (const msg of sorted) {
          if (!msg?.id || msg.id <= knownLast) continue;
          const text = msg.message?.trim();
          if (!text || text.length < 15) continue;
          items.push({
            sourceName: channel,
            sourceId: String(msg.peerId?.channelId ?? channel),
            msgId: msg.id,
            dateISO: msg.date ? msg.date.toISOString() : new Date().toISOString(),
            text,
          });
          perChannelStats[channel].new += 1;
        }

        if (maxId && maxId > knownLast) {
          this.stateStore.setLastMsgId(channel, maxId);
          perChannelStats[channel].lastMsgId = maxId;
        }
      } catch (error) {
        this.logger?.warn(`Channel fetch failed for ${channel}:`, error?.message || error);
        perChannelStats[channel].error = error?.message || String(error);
      }
    }

    this.firstTickDone = true;
    return {
      items,
      fetchedTotal,
      newTotal: items.length,
      perChannelStats,
    };
  }
}
