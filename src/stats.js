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
    topLikers: new Map(),
  };
}

function viewerKey(user) {
  if (user?.id) return `id:${user.id}`;
  if (user?.username) return `username:${user.username.toLowerCase()}`;
  if (user?.name && user.name !== "alguien") return `name:${user.name.toLowerCase()}`;
  return "";
}

function rankedViewers(map, field) {
  return [...map.values()]
    .map((viewer) => ({ ...viewer }))
    .sort((a, b) => b[field] - a[field] || a.name.localeCompare(b.name, "es"))
    .slice(0, 5);
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
      const key = viewerKey(event.user);
      if (!key) break;
      const current = stats.topGifters.get(key) || { name: event.user.name, avatar: "", diamonds: 0, count: 0 };
      current.name = event.user.name || current.name;
      current.avatar = event.user.avatar || current.avatar;
      current.diamonds += diamonds;
      current.count += 1;
      stats.topGifters.set(key, current);
      break;
    }
    case "like": {
      const previous = stats.likes;
      stats.likes = Math.max(stats.likes, Number(event.total) || 0);
      const rawCount = Number(event.count);
      const count = Number.isFinite(rawCount) && rawCount > 0
        ? Math.trunc(rawCount)
        : previous > 0 ? Math.max(0, stats.likes - previous) : 0;
      const key = viewerKey(event.user);
      if (key && count > 0) {
        const current = stats.topLikers.get(key) || { name: event.user.name, avatar: "", count: 0 };
        current.name = event.user.name || current.name;
        current.avatar = event.user.avatar || current.avatar;
        current.count += count;
        stats.topLikers.set(key, current);
      }
      break;
    }
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
    topGifters: rankedViewers(stats.topGifters, "diamonds"),
    topLikers: rankedViewers(stats.topLikers, "count"),
  };
}
