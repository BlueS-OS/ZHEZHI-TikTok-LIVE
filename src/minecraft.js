// Cola efímera: no acumular acciones si Minecraft no está abierto.
import { MAX_BOSSES_PER_EVENT, MAX_MOBS_PER_EVENT, MAX_SPECIALS_PER_EVENT, safeMobName } from "./mob-rules.js";
import { BOSS_MOBS, SPECIAL_ACTIONS, SPAWNABLES } from "../public/js/mob-catalog.js";

export function createMinecraftBridge() {
  let lastPoll = 0;
  let lastVoteAt = 0;
  let lastDelivery = null;
  const queue = [];
  return {
    online(now = Date.now()) { return lastPoll > 0 && now - lastPoll < 5000; },
    lastDelivery() { return lastDelivery; },
    enqueue(interaction, now = Date.now()) {
      if (!this.online(now) || !interaction) return false;
      const action = interaction.kind === "likes" ? "speed"
        : interaction.kind === "gift" ? "zombie"
          : interaction.kind === "vote" && now - lastVoteAt >= 30000
            ? (interaction.choice === "a" ? "day" : interaction.choice === "b" ? "night" : null) : null;
      if (!action) return false;
      if (interaction.kind === "vote") lastVoteAt = now;
      queue.push({ action, at: now });
      if (queue.length > 4) queue.shift();
      return true;
    },
    enqueueMob(action, now = Date.now()) {
      if (!this.online(now) || action?.type !== "mob" || !SPAWNABLES.includes(action.mob)) return false;
      const amount = Number(action.count);
      const cap = BOSS_MOBS.includes(action.mob) ? MAX_BOSSES_PER_EVENT : SPECIAL_ACTIONS.includes(action.mob) ? MAX_SPECIALS_PER_EVENT : MAX_MOBS_PER_EVENT;
      const count = Number.isFinite(amount) ? Math.max(1, Math.min(cap, Math.trunc(amount))) : 1;
      queue.push({ action: { type: "mob", mob: action.mob, name: safeMobName(action.name), count }, at: now });
      if (queue.length > 4) queue.shift();
      return true;
    },
    poll(now = Date.now()) {
      const wasOnline = this.online(now);
      lastPoll = now;
      if (!wasOnline) queue.length = 0;
      let remaining = MAX_MOBS_PER_EVENT;
      let remainingBosses = MAX_BOSSES_PER_EVENT;
      let remainingSpecials = MAX_SPECIALS_PER_EVENT;
      const actions = queue.filter((item) => now - item.at <= 5000).flatMap((item) => {
        if (typeof item.action === "string") return [item.action];
        const boss = BOSS_MOBS.includes(item.action.mob);
        const special = SPECIAL_ACTIONS.includes(item.action.mob);
        if (special ? remainingSpecials <= 0 : remaining <= 0) return [];
        if (boss && remainingBosses <= 0) return [];
        const count = Math.min(special ? remainingSpecials : remaining, boss ? remainingBosses : MAX_MOBS_PER_EVENT, item.action.count);
        if (special) remainingSpecials -= count;
        else remaining -= count;
        if (boss) remainingBosses -= count;
        return [{ ...item.action, count }];
      });
      if (actions.length) lastDelivery = { action: typeof actions[actions.length - 1] === "string" ? actions[actions.length - 1] : `mob:${actions[actions.length - 1].mob}`, at: now };
      queue.length = 0;
      return actions;
    },
    clearActions() { queue.length = 0; },
    clear() { queue.length = 0; lastPoll = 0; lastVoteAt = 0; lastDelivery = null; },
  };
}
