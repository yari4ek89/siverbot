export class ChannelFetcher {
  constructor(client, channels, limit, stateStore, logger) {
    this.client = client;
    this.channels = channels;
    this.limit = limit;
    this.stateStore = stateStore;
    this.logger = logger;
  }

  async tick() {
    const items = [];
    const perChannelStats = {};
    let fetchedTotal = 0;

    for (const channel of this.channels) {
      const lastIdBefore = this.stateStore.getLastMsgId(channel) || 0;
      perChannelStats[channel] = {
        fetched: 0,
        new: 0,
        lastIdBefore,
        maxIdFetched: lastIdBefore,
      };

      try {
        const latest = await this.client.getMessages(channel, { limit: this.limit });
        const sortedLatest = [...latest].sort((a, b) => a.id - b.id);

        fetchedTotal += sortedLatest.length;
        perChannelStats[channel].fetched = sortedLatest.length;

        const maxId = sortedLatest.length ? sortedLatest[sortedLatest.length - 1].id : lastIdBefore;
        perChannelStats[channel].maxIdFetched = maxId;

        if (lastIdBefore === 0) {
          this.stateStore.setLastMsgId(channel, maxId || 0);
          continue;
        }

        const newMsgs = sortedLatest.filter((m) => m?.id && m.id > lastIdBefore);

        for (const msg of newMsgs) {
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

        if (maxId && maxId > lastIdBefore) {
          this.stateStore.setLastMsgId(channel, maxId);
        }
      } catch (error) {
        this.logger?.warn(`Channel fetch failed for ${channel}:`, error?.message || error);
        perChannelStats[channel].error = error?.message || String(error);
      }
    }

    return {
      items,
      fetchedTotal,
      newTotal: items.length,
      perChannelStats,
    };
  }
}
