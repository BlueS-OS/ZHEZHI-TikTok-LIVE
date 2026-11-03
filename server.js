import http from "node:http";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import {
  TTS_DIR,
  ROOT,
  loadConfig,
  saveConfig,
  publicConfig,
  applySettings,
} from "./src/config.js";
import {
  createModerationState,
  evaluateMessage,
  looksLikeQuestion,
  REASON_LABELS,
} from "./src/moderation.js";
import { createReplyState, pickRule, registerReply, registerAi, shouldAskAi } from "./src/rules.js";
import { applyEvent, createStats, statsSnapshot } from "./src/stats.js";
import { buildSummary, summaryPrompt } from "./src/summary.js";
import { VoiceEngine, chatSpeechText } from "./src/tts.js";
import { TikTokManager } from "./src/tiktok.js";
import { Demo } from "./src/demo.js";
import { checkService } from "./src/diagnostics.js";
import { voiceStudioVoices } from "./src/voicestudio.js";
import { AlertAudioStore, AUDIO_KINDS, MAX_ALERT_AUDIO_BYTES } from "./src/alert-audio.js";
import { shouldAnnounceLike } from "./src/like-alert.js";
import { socialAnnouncement } from "./src/voice-announcements.js";

const VERSION = "0.1.4";
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_EVENTS = 400;
const MAX_SUGGESTIONS = 50;

const log = (message) => {
  const time = new Date().toLocaleTimeString("es-ES", { hour12: false });
  console.log(`[${time}] ${message}`);
};

let config = loadConfig();
let stats = createStats();
const events = [];
const suggestions = [];
const moderationState = createModerationState();
const replyState = createReplyState();
let clients = new Set();
let statsTimer = null;
let actualPort = config.port;
let autoReplyWarned = false;
let wasConnected = false;
let lastLikeAlertAt = 0;
let lastJoinSpeechAt = 0;

const manager = new TikTokManager(log);
const voice = new VoiceEngine({ dir: TTS_DIR, log });
const demo = new Demo((event) => handleEvent(event, { demo: true }), log);
const alertAudio = new AlertAudioStore(path.join(ROOT, "data", "alerts"));

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function publicState() {
  return {
    version: VERSION,
    node: process.version,
    config: publicConfig(config),
    status: manager.snapshot(),
    stats: statsSnapshot(stats),
    events: events.slice(0, 120),
    suggestions: suggestions.slice(0, 20),
    overlayUrls: overlayUrls(),
    alertAudio: alertAudio.urls(),
    demo: demo.active,
    reasons: REASON_LABELS,
  };
}

function overlayUrls() {
  const base = `http://127.0.0.1:${actualPort}/overlay.html`;
  return {
    full: base,
    alerts: `${base}?chat=0&captions=0`,
    chat: `${base}?alerts=0&captions=0`,
    clean: `${base}?alerts=0&chat=0&captions=1`,
    likes: `http://127.0.0.1:${actualPort}/likes.html`,
  };
}

function broadcast(message, roles = ["panel", "overlay"]) {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (!roles.includes(client.role)) continue;
    if (client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  }
}

function notice(level, text) {
  log(`${level}: ${text}`);
  broadcast({ type: "notice", level, text, at: Date.now() }, ["panel"]);
}

function broadcastStats() {
  statsTimer = null;
  broadcast({ type: "stats", stats: statsSnapshot(stats) });
}

function scheduleStats(immediate = false) {
  if (immediate) {
    clearTimeout(statsTimer);
    statsTimer = null;
    broadcastStats();
    return;
  }
  if (statsTimer) return;
  statsTimer = setTimeout(broadcastStats, 900);
}

function resetSession(notify = true) {
  stats = createStats();
  events.length = 0;
  suggestions.length = 0;
  moderationState.users.clear();
  replyState.userCooldowns.clear();
  replyState.sent.length = 0;
  replyState.aiSent.length = 0;
  replyState.once.clear();
  autoReplyWarned = false;
  lastLikeAlertAt = 0;
  lastJoinSpeechAt = 0;
  if (notify) {
    broadcast({ type: "reset" });
    scheduleStats(true);
  }
}

/* ------------------------------------------------------------------ */
/* Tubería de eventos                                                  */
/* ------------------------------------------------------------------ */

function speak(event) {
  if (!config.tts.enabled) return;
  const receivedAt = Date.now();
  const t = config.tts;
  let text = "";

  if (event.kind === "chat") {
    if (!t.readChat || event.hidden) return;
    if (t.onlyQuestions && !looksLikeQuestion(event.text)) return;
    if (t.skipCommands && event.text.trim().startsWith("!")) return;
    text = chatSpeechText(event, t);
  } else if (event.kind === "like" && t.readLikes) {
    text = socialAnnouncement(event);
  } else if (event.kind === "join" && t.readJoins) {
    text = socialAnnouncement(event);
  } else if (t.readAlerts && ["follow", "subscribe", "gift"].includes(event.kind)) {
    if (event.kind === "follow") text = `${event.user?.name || "Alguien"} te sigue`;
    if (event.kind === "subscribe") text = `${event.user?.name || "Alguien"} se ha suscrito`;
    if (event.kind === "gift") {
      const count = event.count > 1 ? ` por ${event.count}` : "";
      text = `${event.user?.name || "Alguien"} te envía ${event.gift?.name || "un regalo"}${count}`;
    }
  }

  if (!text) return;
  voice.enqueue(
    text,
    {
      provider: t.provider,
      voice: t.voice,
      sapiVoice: t.sapiVoice,
      voiceStudioPort: t.voiceStudioPort,
      voiceStudioVoice: t.voiceStudioVoice,
      voiceStudioModel: t.voiceStudioModel,
      rate: t.rate,
      volume: t.volume,
      maxChars: t.maxChars,
      minIntervalMs: t.minIntervalMs,
    },
    (result) => {
      broadcast({
        type: "tts",
        tts: {
          id: event.id,
          url: `/tts/${encodeURIComponent(result.fileName)}`,
          text: result.text,
          caption: event.kind === "chat" ? event.text : "",
          provider: result.provider,
          fallbackFrom: result.fallbackFrom || "",
          fallbackReason: result.fallbackReason || "",
          volume: result.provider === "voicestudio" ? config.tts.volume : 100,
          user: event.kind === "chat" ? event.user?.name || "" : "",
          kind: event.kind,
          at: Date.now(),
          sourceAt: receivedAt,
        },
      });
    },
    (error) => {
      notice("warn", `No pude generar la voz: ${error.message}`);
    },
    { kind: event.kind, maxQueue: t.maxQueue },
  );
}

function playCustomAlert(event) {
  const kind = event.kind;
  if (!config.customAudio.enabled || !AUDIO_KINDS.has(kind) || !config.customAudio[kind]) return;
  const url = alertAudio.urls()[kind];
  if (url) broadcast({ type: "alert-sound", kind, url, volume: config.customAudio.volume, at: Date.now() });
}

async function callAi(messages, { maxTokens = 120, temperature = 0.7 } = {}) {
  if (!config.ai.baseUrl) throw new Error("Falta la URL del servicio de IA");
  const headers = { "Content-Type": "application/json" };
  if (config.ai.apiKey) headers.Authorization = `Bearer ${config.ai.apiKey}`;
  const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.ai.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`IA respondió ${response.status} ${detail.slice(0, 160)}`);
  }
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

async function askAiReply(event) {
  const text = await callAi(
    [
      { role: "system", content: config.ai.style },
      {
        role: "user",
        content: `Comentario de ${event.user?.name || "un espectador"}: ${event.text}`,
      },
    ],
    { maxTokens: 90, temperature: 0.8 },
  );
  return text.replace(/^["'«»\s]+|["'«»\s]+$/g, "").replace(/\s+/g, " ").slice(0, 180);
}

async function deliverReply(event, response, source, ruleId = null) {
  if (!response) return;
  const item = {
    type: "suggestion",
    id: event.id,
    at: Date.now(),
    user: event.user?.name || "alguien",
    comment: event.text,
    response,
    source,
    ruleId,
    mode: config.reply.mode,
    sent: false,
    error: "",
  };
  suggestions.unshift(item);
  if (suggestions.length > MAX_SUGGESTIONS) suggestions.length = MAX_SUGGESTIONS;
  broadcast(item, ["panel"]);

  if (config.reply.mode !== "auto") return;
  if (!config.tiktok.signApiKey || !config.tiktok.sessionId) {
    if (!autoReplyWarned) {
      autoReplyWarned = true;
      notice(
        "warn",
        "Las respuestas automáticas necesitan clave de Euler Stream y cookie sessionid. Se muestran como sugerencia.",
      );
    }
    return;
  }
  try {
    const sent = await manager.sendMessage(response);
    item.sent = true;
    item.response = sent;
    broadcast({ type: "suggestion-sent", id: event.id, sent: true }, ["panel"]);
  } catch (error) {
    item.error = error.message;
    broadcast({ type: "suggestion-sent", id: event.id, sent: false, error: error.message }, ["panel"]);
    notice("warn", `No pude responder en el chat: ${error.message}`);
  }
}

function considerReply(event) {
  if (!config.reply.enabled || event.hidden) return;
  if (event.user?.username && event.user.username === config.tiktok.username) return;

  const rule = pickRule(event.text, config.reply, replyState, event.user?.id, event.at);
  if (rule) {
    registerReply(replyState, rule, event.user?.id, event.at);
    deliverReply(event, rule.response, "rule", rule.id).catch(() => {});
    return;
  }

  if (shouldAskAi(event.text, config, replyState, event.at)) {
    registerAi(replyState, event.at);
    askAiReply(event)
      .then((response) => {
        if (response) return deliverReply(event, response, "ai");
        return null;
      })
      .catch((error) => notice("warn", `La IA no respondió: ${error.message}`));
  }
}

function handleEvent(raw, meta = {}) {
  if (!raw || !raw.kind) return;
  const event = {
    id: raw.id,
    at: raw.at || Date.now(),
    kind: raw.kind,
    user: raw.user || { id: "", name: "alguien", username: "", avatar: "" },
    text: raw.text || "",
    gift: raw.gift || null,
    diamonds: raw.diamonds || 0,
    count: raw.count || 1,
    months: raw.months || 0,
    total: raw.total || 0,
    viewers: raw.viewers || 0,
    demo: Boolean(meta.demo),
    hidden: false,
    reasons: [],
  };

  if (event.kind === "like") {
    applyEvent(stats, event);
    scheduleStats();
    const now = Date.now();
    if (shouldAnnounceLike(lastLikeAlertAt, now)) {
      lastLikeAlertAt = now;
      broadcast({ type: "event", event });
      playCustomAlert(event);
      speak(event);
    }
    return;
  }

  if (event.kind === "viewers") {
    applyEvent(stats, event);
    scheduleStats();
    return;
  }

  if (event.kind === "join" && !config.overlay.showJoins && !config.tts.readJoins) {
    return;
  }

  if (event.kind === "chat") {
    const verdict = evaluateMessage(event.text, event.user.id, config.moderation, moderationState, event.at);
    event.hidden = verdict.hidden;
    event.reasons = verdict.reasons;
  }

  if (!event.hidden) {
    applyEvent(stats, event);
  }

  events.unshift(event);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  broadcast({ type: "event", event });
  playCustomAlert(event);
  scheduleStats(event.kind !== "chat");

  if (event.kind === "chat" || event.kind === "question") {
    considerReply(event);
  }
  if (event.kind === "join") {
    const now = Date.now();
    if (config.tts.readJoins && now - lastJoinSpeechAt >= 8000) {
      lastJoinSpeechAt = now;
      speak(event);
    }
  } else {
    speak(event);
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Cuerpo demasiado grande");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readAudio(req) {
  if (Number(req.headers["content-length"]) > MAX_ALERT_AUDIO_BYTES) throw new Error("El audio supera los 12 MB");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_ALERT_AUDIO_BYTES) throw new Error("El audio supera los 12 MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function header(value) {
  return Array.isArray(value) ? value[0] : value || "";
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";

  if (method === "POST" || method === "DELETE") {
    const token = header(req.headers["x-directo"]);
    if (token !== "1") {
      sendJson(res, 403, { error: "Falta la cabecera X-Directo" });
      return true;
    }
    const origin = header(req.headers.origin);
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      sendJson(res, 403, { error: "Origen no permitido" });
      return true;
    }
  }

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, publicState());
    return true;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, version: VERSION, status: manager.snapshot().state });
    return true;
  }

  const audioRoute = /^\/api\/alert-audio\/(follow|gift|like)$/.exec(url.pathname);
  if (audioRoute && ["POST", "DELETE"].includes(method)) {
    try {
      const files = method === "DELETE"
        ? await alertAudio.remove(audioRoute[1])
        : await alertAudio.save(audioRoute[1], await readAudio(req));
      broadcast({ type: "alert-audio-files", audio: files });
      sendJson(res, 200, { ok: true, audio: files });
    } catch (error) {
      sendJson(res, error.message.includes("12 MB") ? 413 : 400, { error: error.message });
    }
    return true;
  }

  if (method === "GET" && url.pathname === "/api/diagnostics") {
    const [tiktok, signing] = await Promise.all([
      checkService("https://www.tiktok.com/"),
      checkService("https://api.eulerstream.com/"),
    ]);
    sendJson(res, 200, { tiktok, signing, lastFailure: manager.snapshot().diagnostic });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/voices") {
    try {
      const voices = await voice.listVoices();
      sendJson(res, 200, voices);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (method === "GET" && url.pathname === "/api/voicestudio/voices") {
    try {
      sendJson(res, 200, { voices: await voiceStudioVoices(config.tts.voiceStudioPort) });
    } catch (error) {
      sendJson(res, 503, { error: `No pude conectar con VoiceStudio: ${error.message}. Ábrelo y espera a que termine de iniciar.` });
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/api/settings") {
    try {
      const patch = await readJson(req);
      config = saveConfig(applySettings(config, patch));
      manager.updateConfig(config);
      autoReplyWarned = false;
      broadcast({ type: "settings", config: publicConfig(config) });
      sendJson(res, 200, { ok: true, config: publicConfig(config) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/api/connect") {
    try {
      const body = await readJson(req);
       if (body?.username || body?.roomId !== undefined) {
         config = saveConfig(
           applySettings(config, { tiktok: {
             ...(body?.username ? { username: String(body.username) } : {}),
             ...(body?.roomId !== undefined ? { roomId: String(body.roomId) } : {}),
           } }),
        );
        broadcast({ type: "settings", config: publicConfig(config) });
      }
      demo.stop();
      await manager.connect(config);
      sendJson(res, 200, { ok: true, status: manager.snapshot() });
    } catch (error) {
      sendJson(res, 400, { error: error.message, status: manager.snapshot() });
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/api/disconnect") {
    await manager.disconnect();
    sendJson(res, 200, { ok: true, status: manager.snapshot() });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/demo") {
    const body = await readJson(req);
    if (body?.on === false) demo.stop();
    else if (body?.kind) demo.emitKind(String(body.kind));
    else demo.start(Number(body?.intervalMs) || 3200);
    sendJson(res, 200, { ok: true, demo: demo.active });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/session/reset") {
    resetSession();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/tts/test") {
    const body = await readJson(req);
    const text = String(body?.text || "Hola, esta es mi voz para el directo.").slice(0, 300);
    const id = `prueba-${Date.now()}`;
    voice.enqueue(
      text,
      {
        provider: config.tts.provider,
        voice: config.tts.voice,
        sapiVoice: config.tts.sapiVoice,
        voiceStudioPort: config.tts.voiceStudioPort,
        voiceStudioVoice: config.tts.voiceStudioVoice,
        voiceStudioModel: config.tts.voiceStudioModel,
        rate: config.tts.rate,
        volume: config.tts.volume,
        maxChars: 300,
        minIntervalMs: 0,
      },
      (result) => {
        broadcast({
          type: "tts",
          tts: {
            id,
            url: `/tts/${encodeURIComponent(result.fileName)}`,
            text: result.text,
            caption: result.text,
            provider: result.provider,
            fallbackFrom: result.fallbackFrom || "",
            fallbackReason: result.fallbackReason || "",
            volume: result.provider === "voicestudio" ? config.tts.volume : 100,
            user: "Prueba",
            kind: "test",
            at: Date.now(),
            sourceAt: Date.now(),
          },
        });
      },
      (error) => notice("warn", `La prueba de voz falló: ${error.message}`),
      { kind: "test" },
    );
    sendJson(res, 202, { ok: true });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/reply/send") {
    try {
      const body = await readJson(req);
      const sent = await manager.sendMessage(String(body?.text || ""));
      sendJson(res, 200, { ok: true, sent });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/api/moderation/test") {
    const body = await readJson(req);
    const verdict = evaluateMessage(
      String(body?.text || ""),
      "prueba",
      config.moderation,
      createModerationState(),
    );
    sendJson(res, 200, { ...verdict, labels: REASON_LABELS });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/summary") {
    const body = await readJson(req);
    const summary = buildSummary(events, { windowMinutes: config.summary.windowMinutes });
    let ai = null;
    let aiError = "";
    if (body?.ai) {
      if (!config.ai.enabled) aiError = "La IA está desactivada en Ajustes.";
      else {
        const sample = events
          .filter((e) => e.kind === "chat" && !e.hidden)
          .slice(0, 18)
          .map((e) => `${e.user?.name || "alguien"}: ${e.text}`)
          .reverse();
        try {
          ai = await callAi(
            [
              {
                role: "system",
                content:
                  "Eres un copiloto de directos de TikTok. Eres breve, concreto y no inventas datos.",
              },
              { role: "user", content: summaryPrompt(summary, sample) },
            ],
            { maxTokens: 350, temperature: 0.4 },
          );
        } catch (error) {
          aiError = error.message;
        }
      }
    }
    sendJson(res, 200, { summary, ai, aiError });
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

async function serveFile(res, filePath, cache = false) {
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": cache ? "public, max-age=3600" : "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${actualPort}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "Ruta desconocida" });
      return;
    }

    if (url.pathname.startsWith("/tts/")) {
      const name = path.basename(decodeURIComponent(url.pathname.slice(5)));
      if (!/^[\w.-]+\.(mp3|wav)$/.test(name)) {
        res.writeHead(400).end("Nombre no válido");
        return;
      }
      await serveFile(res, path.join(TTS_DIR, name), true);
      return;
    }

    const alertFile = /^\/alert-audio\/(follow|gift|like)\.(mp3|wav)$/.exec(url.pathname);
    if (alertFile) {
      const current = alertAudio.file(alertFile[1]);
      if (current?.ext === alertFile[2]) await serveFile(res, current.filePath);
      else res.writeHead(404).end("No encontrado");
      return;
    }

    if (url.pathname === "/" || url.pathname === "/panel" || url.pathname === "/index.html") {
      await serveFile(res, path.join(PUBLIC_DIR, "index.html"));
      return;
    }
    if (url.pathname === "/overlay" || url.pathname === "/overlay.html") {
      await serveFile(res, path.join(PUBLIC_DIR, "overlay.html"));
      return;
    }

    const relative = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const target = path.resolve(PUBLIC_DIR, relative);
    if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
      res.writeHead(403).end("Prohibido");
      return;
    }
    await serveFile(res, target);
  } catch (error) {
    log(`HTTP: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Error interno");
    }
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${actualPort}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const role = url.searchParams.get("role") === "overlay" ? "overlay" : "panel";
    const client = { ws, role };
    clients.add(client);
    ws.send(JSON.stringify({ type: "hello", role, version: VERSION }));
    ws.on("close", () => clients.delete(client));
    ws.on("error", () => clients.delete(client));
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message?.type === "ping") ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
      } catch {
        // Ignorar mensajes raros.
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

manager.on("status", (status) => {
  if (status.state === "connected" && !wasConnected) {
    resetSession(false);
    broadcast({ type: "reset" });
    scheduleStats(true);
  }
  wasConnected = status.state === "connected";
  broadcast({ type: "status", status });
});

manager.on("live", (event) => handleEvent(event));
manager.on("system", ({ text }) => notice("info", text));
manager.on("warning", ({ text }) => notice("warn", text));

async function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error.code === "EADDRINUSE"
        ? new Error(`El puerto ${port} ya está ocupado. Cierra las otras ventanas de Zhezhi y vuelve a abrirlo.`)
        : error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function main() {
  await voice.init();
  const wanted = Number(process.env.PORT) || config.port;
  actualPort = await listen(wanted);
  log(`Panel:   http://127.0.0.1:${actualPort}/`);
  log(`Overlay: http://127.0.0.1:${actualPort}/overlay.html`);
  log(`Datos en ${ROOT}`);

  if (process.env.ZHEZHI_OPEN_BROWSER === "1") {
    const browser = spawn("cmd.exe", ["/c", "start", "", `http://127.0.0.1:${actualPort}/`], {
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
    browser.on("error", (error) => log(`No pude abrir el navegador: ${error.message}`));
    browser.unref();
  }

  if (config.tiktok.autoConnect && config.tiktok.username) {
    setTimeout(() => {
      manager.connect(config).catch((error) => notice("warn", error.message));
    }, 1200);
  }
}

const shutdown = async () => {
  log("Cerrando…");
  demo.stop();
  voice.stop();
  await manager.disconnect().catch(() => {});
  for (const client of clients) {
    try {
      client.ws.close();
    } catch {
      // Nada.
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error("No pude arrancar:", error);
  process.exit(1);
});
