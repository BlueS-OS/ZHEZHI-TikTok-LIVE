const LINK_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|gg|tv|me|link|es|co)\b/i;
const REPEAT_CHAR_RE = /(.)\1{6,}/u;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const LETTER_RE = /\p{L}/gu;
const UPPER_RE = /\p{Lu}/gu;

export const REASON_LABELS = {
  banned: "palabra prohibida",
  link: "enlace",
  caps: "mayúsculas",
  emoji: "demasiados emojis",
  repeat: "mensaje repetido",
  mention: "demasiadas menciones",
  spam: "spam",
};

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function createModerationState() {
  return { users: new Map() };
}

function prune(state, now) {
  if (state.users.size < 4000) return;
  const cutoff = now - 15 * 60 * 1000;
  for (const [key, value] of state.users) {
    if (value.lastAt < cutoff) state.users.delete(key);
  }
}

/**
 * Decide si un comentario se queda en tu pantalla o se oculta.
 * Ocultar aquí no borra nada en TikTok: solo evita mostrarlo, leerlo y responderlo.
 */
export function evaluateMessage(text, userId, cfg, state, now = Date.now()) {
  const reasons = [];
  const raw = String(text ?? "").trim();
  const normalized = normalizeText(raw);

  if (!cfg?.enabled || !raw) {
    return { hidden: false, reasons, normalized };
  }

  const banned = (cfg.bannedWords || []).map(normalizeText).filter(Boolean);
  for (const word of banned) {
    if (!word) continue;
    if (normalized.includes(word)) {
      reasons.push({ code: "banned", detail: word });
      break;
    }
  }

  if (cfg.blockLinks && LINK_RE.test(raw)) {
    reasons.push({ code: "link" });
  }

  const letters = raw.match(LETTER_RE) || [];
  const upper = raw.match(UPPER_RE) || [];
  if (letters.length >= 8 && upper.length / letters.length > cfg.maxCapsRatio) {
    reasons.push({ code: "caps" });
  }

  const emojis = raw.match(EMOJI_RE) || [];
  if (emojis.length > cfg.maxEmojis) {
    reasons.push({ code: "emoji", detail: String(emojis.length) });
  }

  const mentions = (raw.match(/@/g) || []).length;
  if (mentions > cfg.maxMentions) {
    reasons.push({ code: "mention", detail: String(mentions) });
  }

  if (REPEAT_CHAR_RE.test(raw)) {
    reasons.push({ code: "spam" });
  }

  const key = String(userId || "anon");
  const previous = state?.users?.get(key);
  if (
    cfg.blockRepeats &&
    previous &&
    previous.lastText === normalized &&
    now - previous.lastAt <= cfg.repeatWindowSec * 1000
  ) {
    reasons.push({ code: "repeat" });
  }

  if (state?.users) {
    state.users.set(key, { lastText: normalized, lastAt: now });
    prune(state, now);
  }

  const hidden = reasons.length > 0;
  return { hidden, reasons, normalized };
}

// Pequeña ayuda para el filtro de "preguntas" del resumen.
export function looksLikeQuestion(text) {
  const clean = String(text ?? "").trim();
  if (!clean) return false;
  return clean.includes("?") || clean.includes("¿") ||
    /^(que|qué|como|cómo|cuando|cuándo|donde|dónde|quien|quién|por que|por qué|puedes|juegas|haces|hay)\b/i.test(clean);
}
