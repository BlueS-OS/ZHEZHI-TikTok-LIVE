export function createStats() {
  return {
    startedAt: Date.now(),
    messages: 0,
    follows: 0,
    subs: 0,
    shares: 0,
    gifts: 0,
    diamonds: 0,
    likes: 0,
    viewers: 0,
    peakViewers: 0,
    chatters: new Map(),
    topChatters: new Map(),
    topGifters: new Map(),
  };
}

export function applyEvent(stats, event) {
  if (!event) return;
  switch (event.kind) {
    case "chat":
      stats.messages += 1;
      stats.chatters.set(event.user?.username || event.user?.name || "anon", true);
      stats.topChatters.set(
        event.user?.name || "alguien",
        (stats.topChatters.get(event.user?.name || "alguien") || 0) + 1,
      );
      break;
    case "follow":
      stats.follows += 1;
      break;
    case "subscribe":
      stats.subs += 1;
      break;
    case "share":
      stats.shares += 1;
      break;
    case "gift": {
      stats.gifts += 1;
      const diamonds = Number(event.diamonds) || 0;
      stats.diamonds += diamonds;
      const name = event.user?.name || "alguien";
      const current = stats.topGifters.get(name) || { name, diamonds: 0, count: 0 };
      current.diamonds += diamonds;
      current.count += 1;
      stats.topGifters.set(name, current);
      break;
    }
    case "like":
      stats.likes = Math.max(stats.likes, Number(event.total) || 0);
      break;
    case "viewers":
      stats.viewers = Number(event.viewers) || stats.viewers;
      stats.peakViewers = Math.max(stats.peakViewers, stats.viewers);
      break;
    default:
      break;
  }
}

export function statsSnapshot(stats) {
  return {
    startedAt: stats.startedAt,
    uptimeSec: Math.max(0, Math.round((Date.now() - stats.startedAt) / 1000)),
    messages: stats.messages,
    uniqueChatters: stats.chatters.size,
    follows: stats.follows,
    subs: stats.subs,
    shares: stats.shares,
    gifts: stats.gifts,
    diamonds: stats.diamonds,
    likes: stats.likes,
    viewers: stats.viewers,
    peakViewers: stats.peakViewers,
    topChatters: [...stats.topChatters.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    topGifters: [...stats.topGifters.values()]
      .sort((a, b) => b.diamonds - a.diamonds)
      .slice(0, 5),
  };
}
