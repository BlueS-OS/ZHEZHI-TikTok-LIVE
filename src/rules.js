import { looksLikeQuestion, normalizeText } from "./moderation.js";

export function createReplyState() {
  return {
    userCooldowns: new Map(),
    sent: [],
    aiSent: [],
    once: new Set(),
  };
}

export function matchRule(text, rule) {
  if (!rule?.enabled) return false;
  const raw = String(text ?? "").trim();
  const normalized = normalizeText(raw);
  const pattern = String(rule.pattern ?? "").trim();
  if (!pattern) return false;

  switch (rule.match) {
    case "command": {
      const cmd = normalizeText(pattern);
      return normalized === cmd || normalized.startsWith(`${cmd} `);
    }
    case "exact":
      return normalized === normalizeText(pattern);
    case "startsWith":
      return normalized.startsWith(normalizeText(pattern));
    case "regex":
      try {
        return new RegExp(pattern, "iu").test(raw);
      } catch {
        return false;
      }
    case "contains":
    default:
      return normalized.includes(normalizeText(pattern));
  }
}

function pruneBuckets(state, now) {
  const cutoff = now - 60_000;
  state.sent = state.sent.filter((t) => t > cutoff);
  state.aiSent = state.aiSent.filter((t) => t > cutoff);
  if (state.userCooldowns.size > 5000) {
    for (const [key, at] of state.userCooldowns) {
      if (at < now - 60 * 60 * 1000) state.userCooldowns.delete(key);
    }
  }
}

export function pickRule(text, cfg, state, userId, now = Date.now()) {
  pruneBuckets(state, now);
  if (state.sent.length >= Number(cfg.maxPerMinute || 0)) return null;

  for (const rule of cfg.rules || []) {
    if (!matchRule(text, rule)) continue;
    const key = `${rule.id}:${userId || "anon"}`;
    const last = state.userCooldowns.get(key);
    const cooldown = Number(rule.cooldownSec ?? cfg.cooldownSec ?? 0) * 1000;
    if (last !== undefined && now - last < cooldown) continue;
    return rule;
  }
  return null;
}

export function registerReply(state, rule, userId, now = Date.now()) {
  state.sent.push(now);
  state.userCooldowns.set(`${rule.id}:${userId || "anon"}`, now);
  if (rule.oncePerSession) state.once.add(`${rule.id}:${userId || "anon"}`);
}

export function buildReply(text, cfg, state, userId, now = Date.now()) {
  if (!cfg.enabled) return null;
  const rule = pickRule(text, cfg, state, userId, now);
  if (!rule) return null;
  registerReply(state, rule, userId, now);
  return { ruleId: rule.id, response: rule.response, source: "rule" };
}

export function shouldAskAi(text, cfg, state, now = Date.now()) {
  if (!cfg.ai?.enabled || !cfg.ai.baseUrl) return false;
  pruneBuckets(state, now);
  if (state.aiSent.length >= Number(cfg.ai.maxPerMinute || 0)) return false;
  return looksLikeQuestion(text);
}

export function registerAi(state, now = Date.now()) {
  state.aiSent.push(now);
}
