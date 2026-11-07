import { BOSS_MOBS, MOBS, SPECIAL_ACTIONS, SPAWNABLES } from "../public/js/mob-catalog.js";

export { MOBS };
const EVENTS = new Set(["like", "gift", "follow", "chat"]);
const LABELS = new Set(["viewer", "comment", "none"]);
export const MAX_MOBS_PER_EVENT = 20;
export const MAX_BOSSES_PER_EVENT = 5;
export const MAX_SPECIALS_PER_EVENT = 20;

export function normalizeMobRules(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.slice(0, 12).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const event = EVENTS.has(raw.event) ? raw.event : "gift";
    const mob = SPAWNABLES.includes(raw.mob) ? raw.mob : "zombie";
    const boss = BOSS_MOBS.includes(mob);
    const threshold = Number(raw.threshold);
    const cooldown = Number(raw.cooldownSec);
    const amount = Number(raw.amount);
    let id = typeof raw.id === "string" && /^[a-zA-Z0-9_-]{1,60}$/.test(raw.id) ? raw.id : `mob-${index + 1}`;
    if (ids.has(id)) {
      id = `mob-${index + 1}`;
      while (ids.has(id)) id = `${id}-duplicate`;
    }
    ids.add(id);
    return [{
      id,
      enabled: raw.enabled === true && EVENTS.has(raw.event) && SPAWNABLES.includes(raw.mob),
      event,
      mob,
      amount: Number.isFinite(amount) ? Math.max(1, Math.min(boss ? MAX_BOSSES_PER_EVENT : SPECIAL_ACTIONS.includes(mob) ? MAX_SPECIALS_PER_EVENT : MAX_MOBS_PER_EVENT, Math.trunc(amount))) : 1,
      threshold: Number.isFinite(threshold) ? Math.max(1, Math.min(100000, Math.trunc(threshold))) : 1,
      match: typeof raw.match === "string" ? raw.match.trim().slice(0, 80) : "",
      chatMatch: raw.chatMatch === "any" ? "any" : "exact",
      label: LABELS.has(raw.label) ? raw.label : "viewer",
      cooldownSec: Number.isFinite(cooldown) ? Math.max(3, Math.min(3600, Math.trunc(cooldown))) : boss ? 60 : 10,
    }];
  });
}

export function safeMobName(input) {
  return String(input || "").replace(/[\u0000-\u001f\u007f-\u009f\u00a7]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
}

export function createMobRulesState() {
  return new Map();
}

export function hasActiveGiftMobRule(rules) {
  return Array.isArray(rules) && rules.some((rule) => rule.enabled && rule.event === "gift" && SPAWNABLES.includes(rule.mob));
}

export function matchMobRules(state, event, rules, now = Date.now()) {
  if (!event || event.hidden || !Array.isArray(rules)) return [];
  const results = [];
  let remaining = MAX_MOBS_PER_EVENT;
  let remainingBosses = MAX_BOSSES_PER_EVENT;
  let remainingSpecials = MAX_SPECIALS_PER_EVENT;
  for (const rule of rules) {
    if (!rule.enabled || rule.event !== event.kind || !SPAWNABLES.includes(rule.mob)) continue;
    const boss = BOSS_MOBS.includes(rule.mob);
    const special = SPECIAL_ACTIONS.includes(rule.mob);
    if (boss && remainingBosses <= 0) continue;
    if (special && remainingSpecials <= 0) continue;
    const previous = state.get(rule.id) || { count: 0, at: -Infinity };
    if (event.kind === "like") {
      const count = Number(event.count);
      if (!Number.isFinite(count) || count <= 0) continue;
      previous.count = Math.min(100000, previous.count + Math.min(1000, Math.trunc(count)));
      state.set(rule.id, previous);
      if (previous.count < rule.threshold) continue;
    } else if (event.kind === "gift") {
      if (!Number.isFinite(Number(event.diamonds)) || Number(event.diamonds) < rule.threshold) continue;
      if (rule.match && rule.match.toLocaleLowerCase("es") !== String(event.gift?.name || "").toLocaleLowerCase("es")) continue;
    } else if (event.kind === "chat") {
      const text = String(event.text || "").trim();
      if (!text || (rule.chatMatch !== "any" && (!rule.match || rule.match.toLocaleLowerCase("es") !== text.toLocaleLowerCase("es")))) continue;
    }
    if (now - previous.at < Math.max(3, Number(rule.cooldownSec) || 0) * 1000) continue;
    if (!special && remaining <= 0) continue;
    previous.at = now;
    previous.count = 0;
    state.set(rule.id, previous);
    const label = rule.label === "none" ? "" : rule.label === "comment" && event.kind === "chat"
      ? safeMobName(event.text) : safeMobName(event.user?.name);
    const amount = Number(rule.amount);
    const count = Math.min(special ? remainingSpecials : remaining, boss ? remainingBosses : MAX_MOBS_PER_EVENT,
      Number.isFinite(amount) ? Math.max(1, Math.min(boss ? MAX_BOSSES_PER_EVENT : special ? MAX_SPECIALS_PER_EVENT : MAX_MOBS_PER_EVENT, Math.trunc(amount))) : 1);
    results.push({ type: "mob", mob: rule.mob, name: label, count });
    if (special) remainingSpecials -= count;
    else remaining -= count;
    if (boss) remainingBosses -= count;
    if (results.length >= 2) break;
  }
  return results;
}
