export function createInteractions() {
  return { likesPending: 0, lastLikesAt: 0, lastGiftAt: 0, voters: new Map(), votes: [0, 0] };
}

export function interactionSnapshot(state) {
  return { a: state.votes[0], b: state.votes[1] };
}

// Devuelve como máximo un efecto por evento. Los comentarios ocultos nunca votan.
export function applyInteraction(state, event, options, now = Date.now()) {
  if (!options?.enabled || event?.hidden) return null;
  if (event.kind === "like" && options.likes) {
    const count = Number(event.count);
    if (!Number.isFinite(count) || count <= 0) return null;
    state.likesPending += Math.min(1000, Math.trunc(count));
    if (state.likesPending < options.likesStep || now - state.lastLikesAt < 8000) return null;
    state.likesPending %= options.likesStep;
    state.lastLikesAt = now;
    return { kind: "likes", name: event.user?.name || "La comunidad" };
  }
  if (event.kind === "gift" && options.gifts && Number(event.diamonds) >= options.giftMin && now - state.lastGiftAt >= 8000) {
    state.lastGiftAt = now;
    return { kind: "gift", name: event.user?.name || "Alguien", diamonds: Number(event.diamonds) };
  }
  if (event.kind === "chat" && options.comments) {
    const match = /^\s*!(a|b)\s*$/i.exec(event.text || "");
    const user = event.user;
    const key = user?.id ? `id:${user.id}` : user?.username ? `username:${user.username.toLowerCase()}` : "";
    if (!match || !key) return null;
    const choice = match[1].toLowerCase() === "a" ? 0 : 1;
    const previous = state.voters.get(key);
    if (previous === choice) return null;
    if (previous !== undefined) state.votes[previous] -= 1;
    state.voters.set(key, choice);
    state.votes[choice] += 1;
    return { kind: "vote", choice: choice === 0 ? "a" : "b", votes: interactionSnapshot(state) };
  }
  return null;
}
