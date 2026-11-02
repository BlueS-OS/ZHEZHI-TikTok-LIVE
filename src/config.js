import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const CONFIG_PATH = path.join(ROOT, "config.json");
export const CACHE_DIR = path.join(ROOT, "cache");
export const TTS_DIR = path.join(CACHE_DIR, "tts");

const DEFAULT_RULES = [
  {
    id: "redes",
    enabled: true,
    match: "command",
    pattern: "!redes",
    response: "Aquí tienes mis redes: (edita esta respuesta en Respuestas)",
    cooldownSec: 30,
  },
  {
    id: "horario",
    enabled: true,
    match: "command",
    pattern: "!horario",
    response: "Suelo emitir por las tardes. ¡Gracias por pasarte!",
    cooldownSec: 60,
  },
  {
    id: "saludo",
    enabled: false,
    match: "contains",
    pattern: "buenas",
    response: "¡Buenas! Bienvenido al directo.",
    cooldownSec: 120,
  },
];

const DEFAULTS = {
  port: 5180,
  tiktok: {
    username: "",
    roomId: "",
    signApiKey: "",
    sessionId: "",
    ttTargetIdc: "",
    authenticateWs: false,
    autoConnect: false,
  },
  overlay: {
    alerts: true,
    chat: true,
    captions: true,
    chatMax: 12,
    showJoins: false,
    showLikes: false,
    sound: true,
    giftMinDiamonds: 1,
    durationMs: 6000,
  },
  alerts: {
    follow: true,
    subscribe: true,
    gift: true,
    like: true,
    share: false,
  },
  customAudio: {
    enabled: false,
    follow: true,
    gift: true,
    like: true,
    volume: 80,
  },
  tts: {
    enabled: true,
    provider: "edge",
    voice: "es-ES-ElviraNeural",
    sapiVoice: "Microsoft Helena Desktop",
    voiceStudioPort: 3900,
    voiceStudioVoice: "default",
    voiceStudioModel: "tts-1",
    rate: 0,
    volume: 100,
    readChat: true,
    readAlerts: true,
    readLikes: false,
    readJoins: false,
    readNickname: true,
    onlyQuestions: false,
    maxChars: 180,
    minIntervalMs: 900,
    maxQueue: 6,
    skipCommands: true,
  },
  moderation: {
    enabled: true,
    bannedWords: ["puta", "mierda", "idiota", "estafa", "telegram"],
    blockLinks: true,
    maxCapsRatio: 0.75,
    maxEmojis: 8,
    blockRepeats: true,
    repeatWindowSec: 30,
    maxMentions: 4,
    hideFromOverlay: true,
  },
  reply: {
    enabled: true,
    mode: "suggest",
    cooldownSec: 25,
    maxPerMinute: 5,
    rules: DEFAULT_RULES,
  },
  ai: {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    maxPerMinute: 3,
    style:
      "Responde en español, en una sola frase corta (máximo 140 caracteres), con tono cercano y sin inventar datos.",
  },
  summary: {
    windowMinutes: 10,
  },
};

const MATCH_TYPES = new Set(["command", "contains", "exact", "startsWith", "regex"]);

function clone(value) {
  return structuredClone(value);
}

export function defaultConfig() {
  return clone(DEFAULTS);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function text(value, fallback, max = 500) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function normalizeRule(rule, index) {
  if (!isPlainObject(rule)) return null;
  const match = MATCH_TYPES.has(rule.match) ? rule.match : "contains";
  const pattern = text(rule.pattern, "").trim();
  const response = text(rule.response, "").trim();
  if (!pattern || !response) return null;
  return {
    id: text(rule.id, `regla-${index + 1}`, 80).replace(/[^\w-]/g, "") || `regla-${index + 1}`,
    enabled: bool(rule.enabled, true),
    match,
    pattern: pattern.slice(0, 160),
    response: response.slice(0, 500),
    cooldownSec: num(rule.cooldownSec, 25, 0, 3600),
  };
}

export function normalizeConfig(raw) {
  const merged = deepMerge(defaultConfig(), raw);
  const cfg = {
    port: num(merged.port, 5180, 1024, 65535),
    tiktok: {
      username: text(merged.tiktok.username, "", 120).replace(/^@+/, "").trim(),
      roomId: text(merged.tiktok.roomId, "", 40).trim(),
      signApiKey: text(merged.tiktok.signApiKey, "", 300).trim(),
      sessionId: text(merged.tiktok.sessionId, "", 500).trim(),
      ttTargetIdc: text(merged.tiktok.ttTargetIdc, "", 80).trim(),
      authenticateWs: bool(merged.tiktok.authenticateWs, false),
      autoConnect: bool(merged.tiktok.autoConnect, false),
    },
    overlay: {
      alerts: bool(merged.overlay.alerts, true),
      chat: bool(merged.overlay.chat, true),
      captions: bool(merged.overlay.captions, true),
      chatMax: num(merged.overlay.chatMax, 12, 1, 40),
      showJoins: bool(merged.overlay.showJoins, false),
      showLikes: bool(merged.overlay.showLikes, false),
      sound: bool(merged.overlay.sound, true),
      giftMinDiamonds: num(merged.overlay.giftMinDiamonds, 1, 0, 100000),
      durationMs: num(merged.overlay.durationMs, 6000, 2000, 20000),
    },
    alerts: {
      follow: bool(merged.alerts.follow, true),
      subscribe: bool(merged.alerts.subscribe, true),
      gift: bool(merged.alerts.gift, true),
      like: bool(merged.alerts.like, true),
      share: bool(merged.alerts.share, false),
    },
    customAudio: {
      enabled: bool(merged.customAudio.enabled, false),
      follow: bool(merged.customAudio.follow, true),
      gift: bool(merged.customAudio.gift, true),
      like: bool(merged.customAudio.like, true),
      volume: num(merged.customAudio.volume, 80, 0, 100),
    },
    tts: {
      enabled: bool(merged.tts.enabled, true),
      provider: ["edge", "sapi", "voicestudio"].includes(merged.tts.provider) ? merged.tts.provider : "edge",
      voice: text(merged.tts.voice, "es-ES-ElviraNeural", 120),
      sapiVoice: text(merged.tts.sapiVoice, "Microsoft Helena Desktop", 120),
      voiceStudioPort: num(merged.tts.voiceStudioPort, 3900, 1024, 65535),
      voiceStudioVoice: text(merged.tts.voiceStudioVoice, "default", 120),
      voiceStudioModel: text(merged.tts.voiceStudioModel, "tts-1", 120),
      rate: num(merged.tts.rate, 0, -50, 100),
      volume: num(merged.tts.volume, 100, 0, 100),
      readChat: bool(merged.tts.readChat, true),
      readAlerts: bool(merged.tts.readAlerts, true),
      readLikes: bool(merged.tts.readLikes, false),
      readJoins: bool(merged.tts.readJoins, false),
      readNickname: bool(merged.tts.readNickname, true),
      onlyQuestions: bool(merged.tts.onlyQuestions, false),
      maxChars: num(merged.tts.maxChars, 180, 40, 400),
      minIntervalMs: num(merged.tts.minIntervalMs, 900, 0, 10000),
      maxQueue: num(merged.tts.maxQueue, 6, 1, 50),
      skipCommands: bool(merged.tts.skipCommands, true),
    },
    moderation: {
      enabled: bool(merged.moderation.enabled, true),
      bannedWords: Array.isArray(merged.moderation.bannedWords)
        ? merged.moderation.bannedWords
            .filter((w) => typeof w === "string" && w.trim())
            .map((w) => w.trim().slice(0, 60))
            .slice(0, 150)
        : [],
      blockLinks: bool(merged.moderation.blockLinks, true),
      maxCapsRatio: num(merged.moderation.maxCapsRatio, 0.75, 0.3, 1),
      maxEmojis: num(merged.moderation.maxEmojis, 8, 0, 100),
      blockRepeats: bool(merged.moderation.blockRepeats, true),
      repeatWindowSec: num(merged.moderation.repeatWindowSec, 30, 5, 600),
      maxMentions: num(merged.moderation.maxMentions, 4, 0, 50),
      hideFromOverlay: bool(merged.moderation.hideFromOverlay, true),
    },
    reply: {
      enabled: bool(merged.reply.enabled, true),
      mode: merged.reply.mode === "auto" ? "auto" : "suggest",
      cooldownSec: num(merged.reply.cooldownSec, 25, 0, 3600),
      maxPerMinute: num(merged.reply.maxPerMinute, 5, 0, 60),
      rules: Array.isArray(merged.reply.rules)
        ? merged.reply.rules.map(normalizeRule).filter(Boolean).slice(0, 80)
        : clone(DEFAULT_RULES),
    },
    ai: {
      enabled: bool(merged.ai.enabled, false),
      baseUrl: text(merged.ai.baseUrl, "https://api.openai.com/v1", 300).replace(/\/+$/, ""),
      apiKey: text(merged.ai.apiKey, "", 500).trim(),
      model: text(merged.ai.model, "gpt-4o-mini", 120),
      maxPerMinute: num(merged.ai.maxPerMinute, 3, 0, 30),
      style: text(merged.ai.style, DEFAULTS.ai.style, 500),
    },
    summary: {
      windowMinutes: num(merged.summary.windowMinutes, 10, 1, 240),
    },
  };
  return cfg;
}

export function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return normalizeConfig(raw);
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg) {
  const normalized = normalizeConfig(cfg);
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, CONFIG_PATH);
  return normalized;
}

// Lo que ve el navegador: los secretos nunca salen del servidor.
export function publicConfig(cfg) {
  const copy = clone(cfg);
  copy.tiktok.signApiKey = "";
  copy.tiktok.sessionId = "";
  copy.tiktok.hasSignApiKey = Boolean(cfg.tiktok.signApiKey);
  copy.tiktok.hasSession = Boolean(cfg.tiktok.sessionId && cfg.tiktok.ttTargetIdc);
  copy.ai.apiKey = "";
  copy.ai.hasApiKey = Boolean(cfg.ai.apiKey);
  return copy;
}

export function applySettings(cfg, patch) {
  const next = clone(cfg);
  if (!isPlainObject(patch)) return normalizeConfig(next);
  const merged = deepMerge(next, patch);

  // Los campos secretos vacíos significan "no cambiar".
  if (patch.tiktok) {
    if (!patch.tiktok.signApiKey) merged.tiktok.signApiKey = cfg.tiktok.signApiKey;
    if (!patch.tiktok.sessionId) merged.tiktok.sessionId = cfg.tiktok.sessionId;
    if (!patch.tiktok.ttTargetIdc) merged.tiktok.ttTargetIdc = cfg.tiktok.ttTargetIdc;
    if (patch.tiktok.clearSignApiKey) merged.tiktok.signApiKey = "";
    if (patch.tiktok.clearSession) merged.tiktok.sessionId = "";
    delete merged.tiktok.hasSignApiKey;
    delete merged.tiktok.hasSession;
    delete merged.tiktok.clearSignApiKey;
    delete merged.tiktok.clearSession;
  }
  if (patch.ai) {
    if (!patch.ai.apiKey) merged.ai.apiKey = cfg.ai.apiKey;
    if (patch.ai.clearApiKey) merged.ai.apiKey = "";
    delete merged.ai.hasApiKey;
    delete merged.ai.clearApiKey;
  }
  return normalizeConfig(merged);
}
