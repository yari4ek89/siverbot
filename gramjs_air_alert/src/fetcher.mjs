export async function fetchNewMessages({ client, channels, state, fetchLimit }) {
  const allNewMessages = [];
  let fetchedTotal = 0;
  let newTotal = 0;

  for (const channel of channels) {
    const entity = await client.getEntity(channel);
    const messages = await client.getMessages(entity, { limit: fetchLimit });
    const normalized = Array.from(messages).filter((msg) => typeof msg.id === "number");

    fetchedTotal += normalized.length;

    const maxId = normalized.reduce((acc, msg) => Math.max(acc, msg.id), 0);
    const lastMsgId = state.lastMsgIdByChannel[channel] ?? 0;

    if (lastMsgId === 0) {
      state.lastMsgIdByChannel[channel] = maxId;
      continue;
    }

    const newMsgs = normalized
      .filter((msg) => msg.id > lastMsgId)
      .sort((a, b) => a.id - b.id)
      .map((msg) => ({
        channel,
        id: msg.id,
        text: msg.message ?? ""
      }));

    if (maxId > lastMsgId) {
      state.lastMsgIdByChannel[channel] = maxId;
    }

    newTotal += newMsgs.length;
    allNewMessages.push(...newMsgs);
  }

  allNewMessages.sort((a, b) => a.id - b.id);

  return {
    fetchedTotal,
    newTotal,
    messages: allNewMessages
  };
}
