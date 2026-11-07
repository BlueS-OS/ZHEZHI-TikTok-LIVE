import { showAlertVideo } from "./alert-video.js";
import { BOSS_MOBS, MOB_GROUPS, MOB_LABELS, SPECIAL_ACTIONS } from "./mob-catalog.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const store = {
  listenHere: localStorage.getItem("zhezhi.listenHere") !== "0",
  audioQueue: [],
  audioPlaying: false,
  lastTestAudio: null,
  alertAudio: { follow: null, gift: null },
  alertVideo: { follow: null, gift: null, like: null },
  previewStop: null,
  activeAlertSounds: new Set(),
};

let config = null;
let status = { state: "idle" };
let stats = null;
let votes = { a: 0, b: 0 };
let events = [];
let suggestions = [];
let localRules = [];
let reasonLabels = {};
let overlayUrls = {};
let activeView = "connect";
let chatFilter = "all";
let searchTerm = "";
let ws = null;
let wsRetry = 0;
let rulesSaveTimer = null;
let feedFrame = null;
let ttsStatusTimer = null;
let connectBusy = false;
let paused = false;
let rehearsalTimer = null;
let rehearsalResolve = null;
let rehearsalStop = false;
let rehearsalRunning = false;

const STATUS = {
  idle: { label: "Desconectado", tone: "" },
  connecting: { label: "Conectando…", tone: "warn" },
  connected: { label: "En vivo", tone: "live" },
  reconnecting: { label: "Reconectando…", tone: "warn" },
  ended: { label: "Directo terminado", tone: "warn" },
  error: { label: "Error de conexión", tone: "bad" },
};

/* ------------------------------------------------------------------ */
/* API y WebSocket                                                     */
/* ------------------------------------------------------------------ */

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Directo": "1",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

function connectWs() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws?role=panel`);

  ws.addEventListener("open", () => {
    wsRetry = 0;
  });

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(message);
  });

  ws.addEventListener("close", () => {
    const delay = Math.min(8000, 800 + wsRetry * 700);
    wsRetry += 1;
    setTimeout(connectWs, delay);
  });
}

function handleMessage(message) {
  switch (message.type) {
    case "event":
      events.unshift(message.event);
      if (events.length > 400) events.length = 400;
      scheduleFeedRender();
      break;
    case "stats":
      stats = message.stats;
      renderStats();
      break;
    case "status":
      status = message.status;
      renderStatus();
      break;
    case "settings":
      config = message.config;
      syncSettings();
      renderMobRules();
      renderInteractionVotes();
      break;
    case "interaction":
      if (message.interaction?.kind === "vote") {
        votes = message.interaction.votes;
        renderInteractionVotes();
      }
      break;
    case "suggestion":
      suggestions.unshift(message);
      if (suggestions.length > 50) suggestions.length = 50;
      renderSuggestions();
      if (!$("#view-chat").classList.contains("is-active")) {
        toast(`Nueva respuesta sugerida para ${message.user}`);
      }
      break;
    case "suggestion-sent": {
      const item = suggestions.find((s) => s.id === message.id);
      if (item) {
        item.sent = Boolean(message.sent);
        item.error = message.error || "";
      }
      renderSuggestions();
      break;
    }
    case "notice":
      toast(message.text, message.level);
      break;
    case "reset":
      votes = { a: 0, b: 0 };
      renderInteractionVotes();
      events = [];
      suggestions = [];
      scheduleFeedRender();
      renderSuggestions();
      if (activeView === "summary") loadSummary(false);
      break;
    case "tts":
      handleTts(message.tts);
      break;
    case "alert-sound":
      if (store.listenHere) playAlertSound(message);
      break;
    case "alert-audio-files":
      updateAlertAudio(message.audio);
      break;
    case "alert-video-files":
      updateAlertVideo(message.video);
      break;
    case "pause":
      paused = Boolean(message.paused);
      renderPause();
      break;
    case "pong":
    case "hello":
      break;
    default:
      break;
  }
}

setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping" }));
  }
}, 25_000);

/* ------------------------------------------------------------------ */
/* Estado general                                                      */
/* ------------------------------------------------------------------ */

function applyState(data) {
  config = data.config;
  status = data.status || status;
  stats = data.stats || stats;
  votes = data.votes || votes;
  events = (data.events || []).slice();
  suggestions = (data.suggestions || []).slice();
  reasonLabels = data.reasons || {};
  overlayUrls = data.overlayUrls || {};
  updateAlertAudio(data.alertAudio);
  updateAlertVideo(data.alertVideo);
  syncSettings();
  renderMobRules();
  renderStatus();
  renderStats();
  renderInteractionVotes();
  scheduleFeedRender();
  renderSuggestions();
  renderOverlayUrls();
  updateDemoUi(Boolean(data.demo));
  paused = Boolean(data.paused);
  renderPause();
  $("#version-label").textContent = data.version || "0.1.4";
  $("#node-label").textContent = data.node || "—";
  const base = overlayUrls.full ? overlayUrls.full.replace("overlay.html", "") : `${location.origin}/`;
  $("#overlay-base").textContent = base;
}

function renderPause() {
  const button = $("#btn-pause");
  if (!button) return;
  button.classList.toggle("is-paused", paused);
  button.setAttribute("aria-pressed", paused ? "true" : "false");
  button.title = paused
    ? "Reanudar alertas, sonidos y voz (Alt+P)"
    : "Pausar alertas, sonidos y voz (Alt+P)";
  $("#pause-label").textContent = paused ? "Reanudar" : "Pausar";
  document.body.classList.toggle("is-paused", paused);
  if (paused) {
    store.audioQueue.length = 0;
    store.currentAudio?.pause();
    store.currentAudio = null;
    store.audioPlaying = false;
    for (const sound of store.activeAlertSounds) { sound.pause(); sound.src = ""; }
    store.activeAlertSounds.clear();
    store.previewStop?.();
    store.previewStop = null;
  }
}

function renderInteractionVotes() {
  const output = $("#interaction-votes");
  if (output) output.textContent = `Votos: !a ${config?.interactions?.optionA || "A"} ${votes.a || 0} · !b ${config?.interactions?.optionB || "B"} ${votes.b || 0}`;
}

function renderMobRules() {
  const list = $("#minecraft-mob-rules");
  if (!list) return;
  list.replaceChildren();
  const message = $("#minecraft-rules-message");
  const total = $("#minecraft-rule-total");
  if (!config?.minecraft || !Array.isArray(config.minecraft.mobRules)) {
    total.textContent = "— / 12 acciones";
    message.textContent = "El servidor abierto aún no admite reglas de mobs. Detén el demo y reinicia Zhezhi para cargar la nueva versión.";
    $("#btn-add-mob-rule").disabled = true;
    return;
  }
  total.textContent = `${config.minecraft.mobRules.length} / 12 acciones`;
  $("#btn-add-mob-rule").disabled = false;
  if (!message.dataset.error) message.textContent = config.minecraft.mobRules.length ? "" : "Todavía no hay acciones. Pulsa «Crear acción» para empezar.";
  for (const [index, rule] of config.minecraft.mobRules.entries()) {
    const row = document.createElement("div");
    row.className = "mob-rule";
    row.dataset.id = rule.id;
    row.dataset.enabled = rule.enabled ? "true" : "false";
    row.innerHTML = `
      <div class="mob-rule-head">
        <div class="mob-rule-identity"><span class="mob-rule-number">${String(index + 1).padStart(2, "0")}</span><div><strong class="mob-rule-title"></strong><span class="mob-rule-caption"></span></div></div>
        <label class="switch mob-rule-switch"><input type="checkbox" data-mob-field="enabled"><span>Regla activa</span></label>
      </div>
      <div class="grid two">
        <label class="field">Evento<select data-mob-field="event"><option value="like">Me gusta</option><option value="gift">Regalo</option><option value="follow">Seguimiento</option><option value="chat">Comentario</option></select></label>
        <label class="field">Mob<select data-mob-field="mob"></select></label>
        <label class="field"><span class="mob-amount-label">Mobs por evento (máximo 20)</span><input type="number" min="1" max="20" step="1" data-mob-field="amount"></label>
        <label class="field mob-threshold">Cantidad de likes / mínimo de diamantes<input type="number" min="1" max="100000" data-mob-field="threshold"></label>
        <label class="field mob-chat-match">Comentarios<select data-mob-field="chatMatch"><option value="exact">Comentario exacto</option><option value="any">Cualquier comentario</option></select></label>
        <label class="field mob-match">Nombre del regalo / comentario exacto<input maxlength="80" data-mob-field="match" placeholder="Vacío: cualquier regalo"></label>
        <label class="field">Etiqueta del mob<select data-mob-field="label"><option value="viewer">Nombre del espectador</option><option value="comment">Texto del comentario</option><option value="none">Sin nombre</option></select></label>
        <label class="field">Segundos entre apariciones<input type="number" min="3" max="3600" data-mob-field="cooldownSec"><small class="mob-boss-advice" hidden></small></label>
      </div>
      <div class="mob-rule-footer"><span>CONFIGURACIÓN DE ACCIÓN</span><button type="button" class="btn tiny ghost" data-mob-remove>Quitar regla</button></div>`;
    const eventNames = { like: "Me gusta", gift: "Regalo", follow: "Seguimiento", chat: "Comentario" };
    row.querySelector(".mob-rule-title").textContent = `${eventNames[rule.event] || "Evento"} → ${MOB_LABELS[rule.mob] || rule.mob}`;
    row.querySelector(".mob-rule-caption").textContent = `${rule.amount || 1} ${Number(rule.amount) === 1 ? "mob" : "mobs"} por evento · ${rule.enabled ? "Activa" : "Apagada"}`;
    const mobSelect = row.querySelector('[data-mob-field="mob"]');
    for (const group of MOB_GROUPS) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      for (const mob of group.mobs) {
        const option = document.createElement("option");
        option.value = mob;
        option.textContent = MOB_LABELS[mob];
        optgroup.append(option);
      }
      mobSelect.append(optgroup);
    }
    const specialGroup = document.createElement("optgroup");
    specialGroup.label = "Explosivos · solo mundos copiados";
    for (const action of SPECIAL_ACTIONS) {
      const option = document.createElement("option");
      option.value = action;
      option.textContent = MOB_LABELS[action];
      specialGroup.append(option);
    }
    mobSelect.append(specialGroup);
    for (const field of ["enabled", "event", "mob", "amount", "threshold", "chatMatch", "match", "label", "cooldownSec"]) {
      const input = row.querySelector(`[data-mob-field="${field}"]`);
      if (field === "enabled") input.checked = rule.enabled;
      else input.value = rule[field] ?? (field === "chatMatch" ? "exact" : "");
    }
    const updateVisibility = () => {
      const event = row.querySelector('[data-mob-field="event"]').value;
      const boss = BOSS_MOBS.includes(row.querySelector('[data-mob-field="mob"]').value);
      const special = SPECIAL_ACTIONS.includes(row.querySelector('[data-mob-field="mob"]').value);
      row.querySelector(".mob-threshold").hidden = !["like", "gift"].includes(event);
      row.querySelector(".mob-chat-match").hidden = event !== "chat";
      row.querySelector(".mob-match").hidden = !["gift", "chat"].includes(event) || (event === "chat" && row.querySelector('[data-mob-field="chatMatch"]').value === "any");
      row.querySelector('[data-mob-field="label"] option[value="comment"]').disabled = event !== "chat";
      row.querySelector('[data-mob-field="match"]').placeholder = event === "chat" ? "Escribe el comentario exacto" : "Vacío: cualquier regalo";
      row.querySelector('[data-mob-field="amount"]').max = boss ? "5" : "20";
      row.querySelector(".mob-amount-label").textContent = boss ? "Jefes por evento (máximo 5)" : special ? "Explosivos por evento (máximo 20)" : "Mobs por evento (máximo 20)";
      row.querySelector(".mob-boss-advice").textContent = boss ? "Para jefes se recomiendan 60 s o más." : "Para explosivos se recomiendan 30 s o más. TNT explota tras ~4 s; el cristal automático tras ~2 s.";
      row.querySelector(".mob-boss-advice").hidden = !boss && !special;
    };
    updateVisibility();
    row.addEventListener("change", async (event) => {
      if (!event.target.matches("[data-mob-field]")) return;
      const field = event.target.dataset.mobField;
      if (field === "event" && event.target.value !== "chat" && row.querySelector('[data-mob-field="label"]').value === "comment") {
        row.querySelector('[data-mob-field="label"]').value = "viewer";
      }
      const next = (config.minecraft.mobRules || []).map((item) => item.id === rule.id
        ? { ...item, cooldownSec: field === "mob" && BOSS_MOBS.includes(event.target.value) && !BOSS_MOBS.includes(item.mob) ? 60
            : field === "mob" && SPECIAL_ACTIONS.includes(event.target.value) && !SPECIAL_ACTIONS.includes(item.mob) ? 30 : item.cooldownSec,
            [field]: event.target.type === "checkbox" ? event.target.checked : event.target.type === "number" ? Number(event.target.value) : event.target.value,
            label: row.querySelector('[data-mob-field="label"]').value }
        : item);
      try {
        const result = await savePatch({ minecraft: { mobRules: next } });
        if (!result.config.minecraft.mobRules?.some((item) => item.id === rule.id)) throw new Error("El servidor no guardó la acción. Reinicia Zhezhi después de detener el demo.");
        message.dataset.error = "";
        renderMobRules();
      } catch (error) { message.textContent = error.message; message.dataset.error = "true"; toast(error.message, "bad"); }
    });
    row.querySelector("[data-mob-remove]").addEventListener("click", async () => {
      try {
        const result = await savePatch({ minecraft: { mobRules: config.minecraft.mobRules.filter((item) => item.id !== rule.id) } });
        if (result.config.minecraft.mobRules?.some((item) => item.id === rule.id)) throw new Error("El servidor no quitó la acción. Reinicia Zhezhi después de detener el demo.");
        message.dataset.error = "";
        renderMobRules();
      } catch (error) { message.textContent = error.message; message.dataset.error = "true"; toast(error.message, "bad"); }
    });
    list.append(row);
  }
}

function bindMobRules() {
  const button = $("#btn-add-mob-rule");
  const message = $("#minecraft-rules-message");
  button.addEventListener("click", async () => {
    const current = config?.minecraft?.mobRules || [];
    if (current.length >= 12) { toast("Máximo 12 reglas", "warn"); return; }
    const rule = { id: `mob-${crypto.randomUUID().slice(0, 8)}`, enabled: false, event: "gift", mob: "zombie", amount: 1, threshold: 1, chatMatch: "exact", match: "", label: "viewer", cooldownSec: 10 };
    button.disabled = true;
    try {
      const result = await savePatch({ minecraft: { mobRules: [...current, rule] } });
      if (!result.config.minecraft.mobRules?.some((item) => item.id === rule.id)) throw new Error("El servidor abierto todavía no guarda estas acciones. Detén el demo y reinicia Zhezhi.");
      message.dataset.error = "";
      renderMobRules();
    } catch (error) { message.textContent = error.message; message.dataset.error = "true"; toast(error.message, "bad"); }
    finally { button.disabled = false; }
  });
}

async function refreshMinecraftStatus() {
  if (activeView !== "minecraft") return;
  try {
    const result = await api("/api/minecraft/status");
    const output = $("#minecraft-status");
    const connection = output.closest(".minecraft-connection");
    const label = $("#minecraft-connection-label");
    const hasRules = Array.isArray(config?.minecraft?.mobRules);
    const hasActions = (config?.interactions?.enabled && [config?.interactions?.likes, config?.interactions?.gifts, config?.interactions?.comments].some(Boolean)) || config?.minecraft?.mobRules?.some((rule) => rule.enabled);
    connection.dataset.state = !hasRules ? "warning" : !result.connected ? "offline" : !result.enabled || result.paused || !hasActions ? "warning" : "ready";
    label.textContent = !hasRules ? "Reinicia Zhezhi" : !result.connected ? "Sin conexión" : !result.enabled ? "Puente detectado" : result.paused ? "Acciones en pausa" : !hasActions ? "Sin acciones activas" : "Listo para jugar";
    output.textContent = !hasRules
      ? "Puente detectado, pero Zhezhi necesita reiniciarse para cargar el editor de mobs. Detén primero el demo."
      : !result.connected
      ? "Puente desconectado. Abre una instancia Fabric con el mod de Zhezhi y un mundo individual."
      : !result.enabled ? "Minecraft detectado · activa Minecraft y al menos una acción o regla de mob."
        : result.paused ? "Minecraft detectado · acciones pausadas."
          : !hasActions
            ? "Minecraft detectado, pero ninguna regla está activa. Marca corazones, regalos o votación arriba."
          : "Minecraft detectado · listo para recibir acciones.";
  } catch {
    $("#minecraft-status").textContent = "No se pudo consultar el puente. Se reintentará automáticamente.";
    $("#minecraft-connection-label").textContent = "Estado no disponible";
    $("#minecraft-status").closest(".minecraft-connection").dataset.state = "offline";
  }
}

setInterval(refreshMinecraftStatus, 5000);

async function togglePause(force) {
  const next = typeof force === "boolean" ? force : !paused;
  try {
    const data = await api("/api/pause", {
      method: "POST",
      body: JSON.stringify({ paused: next }),
    });
    paused = Boolean(data.paused);
    renderPause();
    toast(paused ? "Directo en pausa: alertas, sonidos y voz silenciados" : "Directo reanudado", paused ? "warn" : "good");
  } catch (error) {
    toast(error.message, "bad");
  }
}

function bindPause() {
  $("#btn-pause").addEventListener("click", () => togglePause());
  document.addEventListener("keydown", (event) => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePause();
    }
  });
}

function renderStatus() {
  const info = STATUS[status.state] || STATUS.idle;
  const pill = $("#status-pill");
  pill.className = `pill ${info.tone}`.trim();
  $("#status-text").textContent = info.label;
  $("#side-status").textContent = info.label;
  const dot = $("#side-dot");
  dot.className = `dot ${info.tone === "live" ? "live" : info.tone}`.trim();

  const user = status.username ? `@${status.username}` : "";
  const room = status.roomId ? `· sala ${status.roomId}` : "";
  const attempt = status.state === "reconnecting" ? `· intento ${status.attempt || 1}/5` : "";
  $("#top-user").textContent = [user, room, attempt].filter(Boolean).join(" ");
  $("#session-room").textContent = status.roomId ? `Sala ${status.roomId}` : status.username ? `@${status.username}` : "Sin sala";

  const connected = ["connected", "connecting", "reconnecting"].includes(status.state);
  $("#btn-connect").disabled = connected || connectBusy;
  $("#btn-connect").textContent = connected ? "Conectado" : "Conectar";
  $("#btn-disconnect").hidden = !connected;

  const errorBox = $("#connect-error");
  if (status.error && ["error", "reconnecting"].includes(status.state)) {
    errorBox.hidden = false;
    errorBox.textContent = status.error;
  } else {
    errorBox.hidden = true;
  }
}

function renderStats() {
  if (!stats) return;
  for (const el of $$("[data-stat]")) {
    const key = el.dataset.stat;
    const value = Number(stats[key] || 0);
    el.textContent = value.toLocaleString("es-ES");
  }
  $("#nav-chat-count").textContent = Number(stats.messages || 0).toLocaleString("es-ES");
  updateUptime();
}

function updateUptime() {
  if (!stats?.startedAt || status.state === "idle") {
    $("#uptime").textContent = "";
    return;
  }
  const total = Math.max(0, Math.floor((Date.now() - stats.startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  $("#uptime").textContent = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

setInterval(updateUptime, 1000);

/* ------------------------------------------------------------------ */
/* Ajustes                                                             */
/* ------------------------------------------------------------------ */

function getPath(object, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

function patchFor(path, value) {
  const parts = path.split(".");
  const patch = {};
  let cursor = patch;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
  return patch;
}

async function savePatch(patch, options = {}) {
  const data = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify(patch),
  });
  config = data.config;
  if (!options.skipSync) syncSettings();
  return data;
}

function controlValue(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "range" || el.type === "number") {
    const scale = Number(el.dataset.scale || 1);
    return Number(el.value) / scale;
  }
  return el.value;
}

function updateOutput(el) {
  const path = el.dataset.setting;
  const output = $(`output[data-for="${path}"]`);
  if (!output) return;
  const value = Number(el.value);
  if (el.dataset.scale) output.textContent = `${Math.round(value)}%`;
  else if (path === "tts.rate" || path === "tts.volume" || path === "customAudio.volume") output.textContent = `${Math.round(value)}%`;
  else output.textContent = String(value);
}

function syncSettingControl(el) {
  if (!config) return;
  if (el === document.activeElement && el.type !== "checkbox" && el.tagName !== "SELECT") return;
  const value = getPath(config, el.dataset.setting);
  if (value === undefined) return;
  if (el.type === "checkbox") {
    el.checked = Boolean(value);
  } else if (el.type === "range" || el.type === "number") {
    const scale = Number(el.dataset.scale || 1);
    el.value = String(Math.round(Number(value) * scale));
    updateOutput(el);
  } else if (el.tagName === "SELECT") {
    const stringValue = String(value);
    if (![...el.options].some((option) => option.value === stringValue)) {
      const option = document.createElement("option");
      option.value = stringValue;
      option.textContent = stringValue;
      el.append(option);
    }
    el.value = stringValue;
  } else {
    el.value = String(value);
  }
}

function syncSettings() {
  if (!config) return;

  for (const el of $$("[data-setting]")) {
    if (el.closest("#rules-list")) continue;
    syncSettingControl(el);
  }
  updateVoiceControls();

  const banned = $("#banned-words");
  if (banned && banned !== document.activeElement) {
    banned.value = (config.moderation.bannedWords || []).join("\n");
  }

  const hasSign = Boolean(config.tiktok.hasSignApiKey);
  const hasSession = Boolean(config.tiktok.hasSession);
  $("#sign-key").placeholder = hasSign ? "•••••••• guardada" : "Sin clave (límite gratuito)";
  $("#session-id").placeholder = hasSession ? "•••••••• guardada" : "No configurada";
  $("#ai-key").placeholder = config.ai.hasApiKey ? "•••••••• guardada" : "Sin clave";
  $("#tt-idc").value = config.tiktok.ttTargetIdc || "";

  const auto = config.reply.mode === "auto";
  const badge = $("#reply-mode-badge");
  badge.textContent = auto ? "Enviar solo" : "Sugerir";
  badge.className = `badge ${auto ? "auto" : ""}`.trim();
  $("#reply-mode-hint").textContent = auto
    ? hasSign && hasSession
      ? "El copiloto escribe en el chat con las reglas. Límite configurado para no hacer spam."
      : "Faltan la clave de Euler Stream y la cookie sessionid: mientras tanto se muestra como sugerencia."
    : "Se muestran aquí para que las pegues tú. Se pueden enviar solas en Respuestas.";
  $("#auto-warning").hidden = !auto || (hasSign && hasSession);

  if (!rulesActive()) {
    localRules = structuredClone(config.reply.rules || []);
    renderRules();
  }
}

function bindSettings() {
  for (const el of $$("[data-setting]")) {
    const eventName = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    let timer = null;
    const flush = () => {
      clearTimeout(timer);
      timer = null;
      const value = controlValue(el);
      savePatch(patchFor(el.dataset.setting, value)).catch((error) => toast(error.message, "bad"));
    };
    el.addEventListener(eventName, () => {
      if (el.type === "range") updateOutput(el);
      clearTimeout(timer);
      timer = setTimeout(flush, el.type === "range" ? 120 : 500);
      if (el.dataset.setting === "summary.windowMinutes") loadSummary(false);
    });
    el.addEventListener("change", () => {
      if (el.type !== "range") flush();
    });
  }

  const banned = $("#banned-words");
  let bannedTimer = null;
  banned.addEventListener("input", () => {
    clearTimeout(bannedTimer);
    bannedTimer = setTimeout(() => {
      const words = banned.value
        .split(/[\n,]+/)
        .map((word) => word.trim())
        .filter(Boolean);
      savePatch({ moderation: { bannedWords: words } }).catch((error) => toast(error.message, "bad"));
    }, 700);
  });

  $("#listen-here").checked = store.listenHere;
  $("#listen-here").addEventListener("change", (event) => {
    store.listenHere = event.target.checked;
    localStorage.setItem("zhezhi.listenHere", store.listenHere ? "1" : "0");
  });
}

/* ------------------------------------------------------------------ */
/* Conexión                                                            */
/* ------------------------------------------------------------------ */

function bindConnection() {
  const connect = async () => {
    const username = $("#username-input").value.trim();
    const roomId = $("#room-id-input").value.trim();
    if (!username) {
      toast("Escribe tu usuario de TikTok", "warn");
      $("#username-input").focus();
      return;
    }
    connectBusy = true;
    renderStatus();
    try {
      const data = await api("/api/connect", {
        method: "POST",
        body: JSON.stringify({ username, roomId }),
      });
      status = data.status;
      toast("Conexión iniciada", "good");
    } catch (error) {
      status = { ...status, state: "error", error: error.message };
      toast(error.message, "bad");
    } finally {
      connectBusy = false;
      renderStatus();
    }
  };

  $("#btn-connect").addEventListener("click", connect);
  $("#btn-diagnose").addEventListener("click", async () => {
    const button = $("#btn-diagnose");
    const result = $("#diagnostic-result");
    button.disabled = true;
    result.hidden = false;
    result.textContent = "Comprobando TikTok y Euler Stream desde Zhezhi…";
    try {
      const data = await api("/api/diagnostics");
      const line = (name, service) => service.reachable
        ? `${name}: responde por Internet (HTTP ${service.httpStatus}; incluso 403/404 indica que el servidor es accesible).`
        : `${name}: sin conexión (${service.networkCode}).`;
      const last = data.lastFailure;
      result.textContent = [
        line("TikTok", data.tiktok),
        line("Euler Stream", data.signing),
        last ? `Último error: ${last.type}${last.reason ? ` · ${last.reason}` : ""}${last.networkCode ? ` · ${last.networkCode}` : ""}${last.httpStatus ? ` · HTTP ${last.httpStatus}` : ""}.` : "Aún no hay un intento de conexión fallido.",
      ].join("\n");
    } catch (error) {
      result.textContent = error.message === "Ruta desconocida"
        ? "El servidor sigue en una versión anterior. Cierra la ventana de consola de Zhezhi, vuelve a abrir Iniciar Zhezhi.bat y recarga este panel."
        : `No pude hacer el diagnóstico: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
  $("#username-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") connect();
  });
  $("#btn-disconnect").addEventListener("click", async () => {
    try {
      await api("/api/disconnect", { method: "POST", body: "{}" });
      toast("Desconectado");
    } catch (error) {
      toast(error.message, "bad");
    }
  });
  $("#btn-reset-session").addEventListener("click", resetSession);
  $("#btn-reset-all").addEventListener("click", resetSession);
  $("#btn-reload").addEventListener("click", reloadState);
}

async function resetSession() {
  if (!confirm("¿Reiniciar los contadores y vaciar el historial de esta sesión? Esta acción no se puede deshacer.")) return;
  try {
    await api("/api/session/reset", { method: "POST", body: "{}" });
    events = [];
    suggestions = [];
    scheduleFeedRender();
    renderSuggestions();
    toast("Contadores reiniciados", "good");
  } catch (error) {
    toast(error.message, "bad");
  }
}

async function reloadState() {
  try {
    const data = await api("/api/state");
    applyState(data);
    toast("Ajustes recargados", "good");
  } catch (error) {
    toast(error.message, "bad");
  }
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

function bindDemo() {
  $("#btn-demo").addEventListener("click", () => {
    const active = $("#btn-demo-start").dataset.active === "1";
    setDemo(!active);
  });
  $("#btn-demo-start").addEventListener("click", () => setDemo(true));
  $("#btn-demo-stop").addEventListener("click", () => setDemo(false));
  for (const chip of $$("[data-demo]")) {
    chip.addEventListener("click", async () => {
      try {
        await api("/api/demo", {
          method: "POST",
          body: JSON.stringify({ kind: chip.dataset.demo, tier: chip.dataset.demoTier || "" }),
        });
      } catch (error) {
        toast(error.message, "bad");
      }
    });
  }
  $("#btn-rehearsal").addEventListener("click", runRehearsal);
  $("#btn-rehearsal-stop").addEventListener("click", stopRehearsal);
}

function rehearsalWait(ms) {
  return new Promise((resolve) => {
    clearTimeout(rehearsalTimer);
    rehearsalResolve = resolve;
    rehearsalTimer = setTimeout(() => {
      rehearsalTimer = null;
      rehearsalResolve = null;
      resolve();
    }, ms);
  });
}

async function runRehearsal() {
  if (rehearsalRunning) return;
  rehearsalRunning = true;
  rehearsalStop = false;
  $("#btn-rehearsal").disabled = true;
  $("#btn-rehearsal-stop").hidden = false;
  const steps = [
    { kind: "follow" },
    { kind: "gift", tier: "large" },
    { kind: "subscribe" },
    { kind: "like" },
    { kind: "chat" },
  ];
  try {
    for (const step of steps) {
      if (rehearsalStop) break;
      await api("/api/demo", {
        method: "POST",
        body: JSON.stringify(step),
      });
      await rehearsalWait(step.kind === "like" ? 1100 : 1800);
    }
    if (!rehearsalStop) toast("Secuencia de prueba terminada", "good");
  } catch (error) {
    toast(error.message, "bad");
  } finally {
    rehearsalRunning = false;
    clearTimeout(rehearsalTimer);
    rehearsalTimer = null;
    rehearsalResolve = null;
    $("#btn-rehearsal").disabled = false;
    $("#btn-rehearsal-stop").hidden = true;
  }
}

function stopRehearsal() {
  rehearsalStop = true;
  clearTimeout(rehearsalTimer);
  rehearsalTimer = null;
  const resolve = rehearsalResolve;
  rehearsalResolve = null;
  if (resolve) resolve();
  toast("Prueba detenida");
}

async function setDemo(on) {
  try {
    const data = await api("/api/demo", {
      method: "POST",
      body: JSON.stringify({ on }),
    });
    updateDemoUi(data.demo);
    toast(data.demo ? "Modo demo activado" : "Modo demo desactivado");
  } catch (error) {
    toast(error.message, "bad");
  }
}

function updateDemoUi(active) {
  $("#btn-demo-start").dataset.active = active ? "1" : "0";
  $("#btn-demo-start").hidden = active;
  $("#btn-demo-stop").hidden = !active;
  $("#demo-label").textContent = active ? "Parar demo" : "Modo demo";
  $("#btn-demo").classList.toggle("is-demo-active", active);
  $("#btn-demo").setAttribute("aria-pressed", String(active));
}

/* ------------------------------------------------------------------ */
/* Chat                                                               */
/* ------------------------------------------------------------------ */

function matchesFilter(event) {
  if (searchTerm) {
    const haystack = `${event.user?.name || ""} ${event.user?.username || ""} ${event.text || ""}`.toLowerCase();
    if (!haystack.includes(searchTerm)) return false;
  }
  switch (chatFilter) {
    case "chat":
      return event.kind === "chat" || event.kind === "question";
    case "gift":
      return event.kind === "gift";
    case "new":
      return ["follow", "subscribe", "join", "share"].includes(event.kind);
    case "hidden":
      return Boolean(event.hidden);
    case "all":
    default:
      return true;
  }
}

function eventLine(event) {
  switch (event.kind) {
    case "gift":
      return `envía ${event.gift?.name || "un regalo"}${event.count > 1 ? ` ×${event.count}` : ""}`;
    case "follow":
      return "te sigue";
    case "subscribe":
      return `se ha suscrito${event.months > 1 ? ` (${event.months} meses)` : ""}`;
    case "share":
      return "ha compartido el directo";
    case "join":
      return "ha entrado al directo";
    case "question":
      return event.text || "pregunta";
    default:
      return event.text || "";
  }
}

function makeMessage(event) {
  const wrap = document.createElement("div");
  wrap.className = `msg kind-${event.kind}${event.hidden ? " hidden" : ""}`;
  wrap.dataset.id = event.id;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  if (event.kind === "gift" && event.gift?.image) {
    avatar.classList.add("gift");
    const img = document.createElement("img");
    img.src = event.gift.image;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    avatar.append(img);
  } else if (event.user?.avatar) {
    const img = document.createElement("img");
    img.src = event.user.avatar;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      img.remove();
      avatar.textContent = initials(event.user?.name);
    });
    avatar.append(img);
  } else {
    avatar.textContent = event.kind === "gift" ? "🎁" : initials(event.user?.name);
    avatar.style.background = `hsl(${hash(event.user?.name || "?") % 360} 22% 24%)`;
  }

  const body = document.createElement("div");
  body.className = "msg-body";

  const head = document.createElement("div");
  head.className = "msg-head";
  const name = document.createElement("span");
  name.className = "msg-name";
  name.textContent = event.user?.name || "alguien";
  const handle = document.createElement("span");
  handle.className = "msg-handle";
  handle.textContent = event.user?.username ? `@${event.user.username}` : "";
  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatClock(event.at);
  head.append(name, handle, time);

  const text = document.createElement("div");
  text.className = "msg-text";
  text.textContent = eventLine(event);

  const tags = document.createElement("div");
  tags.className = "msg-tags";
  if (event.kind === "gift" && event.diamonds > 0) {
    tags.append(tag(`${event.diamonds} diamantes`, "gold"));
  }
  if (event.kind === "question") tags.append(tag("pregunta"));
  if (event.demo) tags.append(tag("demo"));
  if (event.hidden) {
    for (const reason of event.reasons || []) {
      tags.append(tag(reasonLabels[reason.code] || reason.code, "red"));
    }
  }

  body.append(head, text);
  if (tags.childElementCount) body.append(tags);
  wrap.append(avatar, body);
  return wrap;
}

function tag(text, tone = "") {
  const span = document.createElement("span");
  span.className = `tag ${tone}`.trim();
  span.textContent = text;
  return span;
}

function initials(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function hash(text) {
  let value = 0;
  for (const char of String(text)) value = (value * 31 + char.charCodeAt(0)) % 100000;
  return value;
}

function formatClock(timestamp) {
  const date = new Date(timestamp || Date.now());
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function scheduleFeedRender() {
  if (feedFrame) return;
  feedFrame = requestAnimationFrame(() => {
    feedFrame = null;
    renderFeed();
  });
}

function renderFeed() {
  const feed = $("#chat-feed");
  const previousScroll = feed.scrollTop;
  const nearBottom = feed.scrollHeight - previousScroll - feed.clientHeight < 140;
  feed.innerHTML = "";

  const ordered = [...events].reverse().slice(-250);
  let visible = 0;
  for (const event of ordered) {
    const node = makeMessage(event);
    if (matchesFilter(event)) visible += 1;
    else node.dataset.filtered = "1";
    feed.append(node);
  }

  if (!visible) {
    const empty = document.createElement("div");
    empty.className = "empty";
    if (events.length && (chatFilter !== "all" || searchTerm)) {
      empty.innerHTML = "<strong>Sin resultados</strong><span>Prueba con otro filtro o búsqueda.</span>";
    } else {
      empty.innerHTML = "<strong>El chat está en silencio</strong><span>Conecta tu directo o activa el modo demo para verlo aquí.</span>";
    }
    feed.append(empty);
  }

  if ($("#chat-autoscroll").checked && (nearBottom || events.length < 5)) {
    feed.scrollTop = feed.scrollHeight;
  } else if (previousScroll) {
    feed.scrollTop = previousScroll;
  }

  if (activeView === "chat") {
    $("#nav-chat-count").textContent = Number(stats?.messages || 0).toLocaleString("es-ES");
  }
}

function bindChat() {
  const filters = ["all", "chat", "gift", "new", "hidden"];
  const savedFilter = localStorage.getItem("zhezhi.chatFilter");
  if (filters.includes(savedFilter)) chatFilter = savedFilter;
  for (const button of $$("#chat-filters button")) {
    button.classList.toggle("is-active", button.dataset.filter === chatFilter);
  }
  const savedScroll = localStorage.getItem("zhezhi.autoscroll");
  if (savedScroll === "0") $("#chat-autoscroll").checked = false;

  $("#chat-autoscroll").addEventListener("change", () => {
    localStorage.setItem("zhezhi.autoscroll", $("#chat-autoscroll").checked ? "1" : "0");
    renderFeed();
  });
  $("#btn-clear-chat").addEventListener("click", () => {
    events = [];
    renderFeed();
  });
  $("#chat-search").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim().toLowerCase();
    renderFeed();
  });
  for (const button of $$("#chat-filters button")) {
    button.addEventListener("click", () => {
      chatFilter = button.dataset.filter;
      localStorage.setItem("zhezhi.chatFilter", chatFilter);
      for (const sibling of $$("#chat-filters button")) {
        sibling.classList.toggle("is-active", sibling === button);
      }
      renderFeed();
    });
  }
}

/* ------------------------------------------------------------------ */
/* Sugerencias                                                         */
/* ------------------------------------------------------------------ */

function renderSuggestions() {
  const container = $("#suggestions");
  if (!container) return;
  container.innerHTML = "";
  if (!suggestions.length) {
    const empty = document.createElement("div");
    empty.className = "empty small";
    empty.innerHTML = "<span>Aún no hay sugerencias.</span>";
    container.append(empty);
    return;
  }

  for (const item of suggestions.slice(0, 20)) {
    const card = document.createElement("div");
    card.className = "suggestion";

    const comment = document.createElement("div");
    comment.className = "s-comment";
    const who = document.createElement("strong");
    who.textContent = item.user;
    comment.append(who, document.createTextNode(`: ${item.comment}`));

    const response = document.createElement("div");
    response.className = "s-response";
    response.textContent = item.response;

    const meta = document.createElement("div");
    meta.className = "s-meta";
    meta.append(tag(item.source === "ai" ? "IA" : "regla"));
    if (item.sent) meta.append(tag("enviado", "gold"));
    if (item.error) meta.append(tag("fallo", "red"));

    const copy = document.createElement("button");
    copy.className = "btn tiny ghost";
    copy.textContent = "Copiar";
    copy.addEventListener("click", () => copyText(item.response));

    const send = document.createElement("button");
    send.className = "btn tiny";
    send.textContent = "Enviar";
    send.addEventListener("click", async () => {
      send.disabled = true;
      try {
        await api("/api/reply/send", {
          method: "POST",
          body: JSON.stringify({ text: item.response }),
        });
        item.sent = true;
        toast("Respuesta enviada", "good");
      } catch (error) {
        item.error = error.message;
        toast(error.message, "bad");
      } finally {
        renderSuggestions();
      }
    });

    meta.append(copy, send);
    card.append(comment, response, meta);
    container.append(card);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copiado", "good");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast("Copiado", "good");
  }
}

/* ------------------------------------------------------------------ */
/* Reglas                                                              */
/* ------------------------------------------------------------------ */

const MATCH_LABELS = {
  command: "Comando",
  contains: "Contiene",
  exact: "Exacto",
  startsWith: "Empieza por",
  regex: "Regex",
};

function rulesActive() {
  const list = $("#rules-list");
  return list && list.contains(document.activeElement);
}

function renderRules() {
  const list = $("#rules-list");
  if (!list) return;
  list.innerHTML = "";
  localRules.forEach((rule, index) => list.append(ruleRow(rule, index)));
}

function ruleRow(rule, index) {
  const row = document.createElement("div");
  row.className = "rule";
  row.dataset.id = rule.id;

  const toggle = document.createElement("label");
  toggle.className = "switch";
  toggle.title = "Activa";
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = Boolean(rule.enabled);
  check.addEventListener("change", () => updateRule(rule.id, { enabled: check.checked }));
  const checkSpan = document.createElement("span");
  toggle.append(check, checkSpan);

  const select = document.createElement("select");
  for (const [value, label] of Object.entries(MATCH_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = rule.match;
  select.addEventListener("change", () => updateRule(rule.id, { match: select.value }));

  const pattern = document.createElement("input");
  pattern.className = "rule-pattern";
  pattern.value = rule.pattern;
  pattern.placeholder = index === 0 ? "!redes" : "texto o regex";
  pattern.addEventListener("input", () => updateRule(rule.id, { pattern: pattern.value }));

  const response = document.createElement("textarea");
  response.className = "rule-response";
  response.value = rule.response;
  response.placeholder = "Qué responde";
  response.addEventListener("input", () => updateRule(rule.id, { response: response.value }));

  const cooldown = document.createElement("input");
  cooldown.type = "number";
  cooldown.min = "0";
  cooldown.max = "3600";
  cooldown.value = String(rule.cooldownSec ?? 25);
  cooldown.title = "Espera por usuario (segundos)";
  cooldown.addEventListener("input", () => updateRule(rule.id, { cooldownSec: Number(cooldown.value) || 0 }));

  const del = document.createElement("button");
  del.className = "del";
  del.title = "Eliminar regla";
  del.textContent = "✕";
  del.addEventListener("click", () => removeRule(rule.id));

  row.append(toggle, select, pattern, response, cooldown, del);
  return row;
}

function updateRule(id, patch) {
  const rule = localRules.find((item) => item.id === id);
  if (!rule) return;
  Object.assign(rule, patch);
  clearTimeout(rulesSaveTimer);
  rulesSaveTimer = setTimeout(saveRules, 650);
}

function saveRules() {
  rulesSaveTimer = null;
  const valid = localRules
    .filter((rule) => String(rule.pattern || "").trim() && String(rule.response || "").trim())
    .map((rule) => ({
      id: rule.id,
      enabled: Boolean(rule.enabled),
      match: rule.match,
      pattern: String(rule.pattern).trim(),
      response: String(rule.response).trim(),
      cooldownSec: Number(rule.cooldownSec) || 0,
    }));
  savePatch({ reply: { rules: valid } }).catch((error) => toast(error.message, "bad"));
}

function removeRule(id) {
  localRules = localRules.filter((rule) => rule.id !== id);
  renderRules();
  saveRules();
}

function bindRules() {
  $("#btn-add-rule").addEventListener("click", () => {
    const id = `regla-${Date.now()}`;
    localRules.push({
      id,
      enabled: true,
      match: "command",
      pattern: "!nuevo",
      response: "Escribe aquí la respuesta",
      cooldownSec: 25,
    });
    renderRules();
    saveRules();
    const last = $("#rules-list").lastElementChild;
    last?.querySelector(".rule-pattern")?.focus();
    last?.querySelector(".rule-pattern")?.select();
  });

  $("#rules-list").addEventListener("focusout", () => {
    setTimeout(() => {
      if (!rulesActive() && config && !rulesSaveTimer) {
        localRules = structuredClone(config.reply.rules || []);
        renderRules();
      }
    }, 700);
  });
}

/* ------------------------------------------------------------------ */
/* Secretos                                                            */
/* ------------------------------------------------------------------ */

function bindSecrets() {
  $("#btn-save-secrets").addEventListener("click", async () => {
    const signApiKey = $("#sign-key").value.trim();
    const sessionId = $("#session-id").value.trim();
    const ttTargetIdc = $("#tt-idc").value.trim();
    const patch = { tiktok: {} };
    if (signApiKey) patch.tiktok.signApiKey = signApiKey;
    if (sessionId) patch.tiktok.sessionId = sessionId;
    if (ttTargetIdc) patch.tiktok.ttTargetIdc = ttTargetIdc;
    if (!Object.keys(patch.tiktok).length) {
      toast("No hay nada nuevo que guardar", "warn");
      return;
    }
    try {
      await savePatch(patch);
      $("#sign-key").value = "";
      $("#session-id").value = "";
      toast("Secretos guardados", "good");
    } catch (error) {
      toast(error.message, "bad");
    }
  });

  for (const button of $$("[data-clear]")) {
    button.addEventListener("click", async () => {
      const kind = button.dataset.clear;
      const patch =
        kind === "sign"
          ? { tiktok: { clearSignApiKey: true } }
          : kind === "session"
            ? { tiktok: { clearSession: true } }
            : { ai: { clearApiKey: true } };
      try {
        await savePatch(patch);
        $("#sign-key").value = "";
        $("#session-id").value = "";
        $("#ai-key").value = "";
        toast("Borrado", "good");
      } catch (error) {
        toast(error.message, "bad");
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Copia de seguridad                                                  */
/* ------------------------------------------------------------------ */

function bindBackup() {
  $("#btn-export-config").addEventListener("click", async () => {
    try {
      const data = await api("/api/config/export");
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `zhezhi-ajustes-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      $("#backup-status").textContent = "Configuración exportada sin secretos.";
      toast("Copia exportada", "good");
    } catch (error) {
      toast(error.message, "bad");
    }
  });

  $("#btn-import-config").addEventListener("click", () => $("#import-config-file").click());
  $("#import-config-file").addEventListener("change", async () => {
    const input = $("#import-config-file");
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("El archivo es demasiado grande", "bad");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast("El archivo no es un JSON válido", "bad");
      return;
    }
    const incoming = parsed?.config && typeof parsed.config === "object" ? parsed.config : parsed;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      toast("El archivo no contiene una configuración válida", "bad");
      return;
    }
    if (!confirm("¿Importar esta configuración? Se reemplazarán las opciones actuales, pero se conservarán tus secretos.")) {
      return;
    }
    try {
      const data = await api("/api/config/import", {
        method: "POST",
        body: JSON.stringify({ config: incoming }),
      });
      config = data.config;
      syncSettings();
      $("#backup-status").textContent = "Configuración importada. Los secretos guardados se conservaron.";
      toast("Configuración importada", "good");
    } catch (error) {
      toast(error.message, "bad");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

async function loadSummary(useAi) {
  try {
    const data = await api("/api/summary", {
      method: "POST",
      body: JSON.stringify({ ai: Boolean(useAi) }),
    });
    renderSummary(data);
    if (data.aiError) toast(data.aiError, "bad");
  } catch (error) {
    toast(error.message, "bad");
  }
}

function summaryStat(value, label) {
  const div = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = value;
  const small = document.createElement("small");
  small.textContent = label;
  div.append(strong, small);
  return div;
}

function renderSummary(data) {
  const totals = data.summary.totals;
  const container = $("#summary-totals");
  container.innerHTML = "";
  container.append(
    summaryStat(String(totals.perMinute), "mensajes / min"),
    summaryStat(String(totals.activeUsers), "personas activas"),
    summaryStat(String(totals.follows), "seguidores"),
    summaryStat(String(totals.subs), "suscripciones"),
    summaryStat(String(totals.diamonds), "diamantes"),
    summaryStat(String(totals.hidden), "ocultos"),
  );

  const questions = $("#summary-questions");
  questions.innerHTML = "";
  if (!data.summary.questions.length) {
    questions.append(emptyNode("Sin preguntas todavía."));
  } else {
    data.summary.questions.forEach((question) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.append(spanNode("?", "rank"), spanNode(question.text, "q-text"), spanNode(question.name, "value"));
      questions.append(item);
    });
  }

  const words = $("#summary-words");
  words.innerHTML = "";
  if (!data.summary.words.length) words.append(spanNode("—", "muted"));
  else {
    data.summary.words.forEach((word) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `${word.word} · ${word.count}`;
      words.append(chip);
    });
  }

  const users = $("#summary-users");
  users.innerHTML = "";
  if (!data.summary.topChatters.length) users.append(emptyNode("Sin actividad."));
  else {
    data.summary.topChatters.forEach((user, index) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.append(
        spanNode(String(index + 1).padStart(2, "0"), "rank"),
        spanNode(user.name),
        spanNode(`${user.count} mensajes`, "value"),
      );
      users.append(item);
    });
  }

  const gifters = $("#summary-gifters");
  gifters.innerHTML = "";
  if (!data.summary.topGifters.length) gifters.append(emptyNode("Sin regalos."));
  else {
    data.summary.topGifters.forEach((gifter, index) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.append(
        spanNode(String(index + 1).padStart(2, "0"), "rank"),
        spanNode(gifter.name),
        spanNode(`${gifter.diamonds} 💎`, "value"),
      );
      gifters.append(item);
    });
  }

  const card = $("#summary-ai-card");
  if (data.ai || data.aiError) {
    card.hidden = false;
    $("#summary-ai").textContent = data.ai || `No pude generar el análisis: ${data.aiError}`;
  }
}

function spanNode(text, className = "") {
  const span = document.createElement("span");
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

function emptyNode(text) {
  const div = document.createElement("div");
  div.className = "empty small";
  div.append(spanNode(text));
  return div;
}

/* ------------------------------------------------------------------ */
/* Moderación                                                          */
/* ------------------------------------------------------------------ */

function bindModeration() {
  $("#btn-mod-test").addEventListener("click", async () => {
    const text = $("#mod-test-text").value;
    try {
      const data = await api("/api/moderation/test", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      const box = $("#mod-result");
      box.innerHTML = "";
      const verdict = document.createElement("div");
      verdict.className = `mod-verdict${data.hidden ? " hidden" : ""}`;
      verdict.textContent = data.hidden ? "Se ocultaría" : "Pasaría el filtro";
      for (const reason of data.reasons || []) {
        verdict.append(tag(data.labels?.[reason.code] || reason.code));
      }
      box.append(verdict);
    } catch (error) {
      toast(error.message, "bad");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Voz                                                                 */
/* ------------------------------------------------------------------ */

async function loadVoices() {
  try {
    const data = await api("/api/voices");
    const edge = $("#tts-voice");
    const sapi = $("#tts-sapi");
    const currentEdge = edge.value;
    const currentSapi = sapi.value;
    edge.innerHTML = "";
    for (const voice of data.edge || []) {
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = `${voice.name} · ${voice.locale}`;
      edge.append(option);
    }
    sapi.innerHTML = "";
    if (!data.sapi?.length) {
      const option = document.createElement("option");
      option.value = "Microsoft Helena Desktop";
      option.textContent = "Helena (es-ES)";
      sapi.append(option);
    } else {
      for (const name of data.sapi) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        sapi.append(option);
      }
    }
    if (config) {
      if (![...edge.options].some((option) => option.value === config.tts.voice)) {
        const option = document.createElement("option");
        option.value = config.tts.voice;
        option.textContent = config.tts.voice;
        edge.append(option);
      }
      edge.value = config.tts.voice;
      if (![...sapi.options].some((option) => option.value === config.tts.sapiVoice)) {
        const option = document.createElement("option");
        option.value = config.tts.sapiVoice;
        option.textContent = config.tts.sapiVoice;
        sapi.append(option);
      }
      sapi.value = config.tts.sapiVoice;
    } else {
      edge.value = currentEdge;
      sapi.value = currentSapi;
    }
  } catch (error) {
    console.warn("No pude cargar las voces", error);
  }
}

function updateVoiceControls() {
  const provider = $("#tts-provider").value;
  $("#tts-voice").closest(".field").hidden = provider !== "edge";
  $("#tts-sapi").closest(".field").hidden = provider !== "sapi";
  $("#voicestudio-controls").hidden = provider !== "voicestudio";
}

async function loadVoiceStudioVoices() {
  const status = $("#voicestudio-status");
  status.textContent = "Buscando VoiceStudio en tu PC…";
  try {
    const data = await api("/api/voicestudio/voices");
    const select = $("#tts-voicestudio-voice");
    const selected = config?.tts.voiceStudioVoice || "default";
    select.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "default";
    defaultOption.textContent = "Predeterminada";
    select.append(defaultOption);
    for (const voice of data.voices || []) {
      if (voice.id === "default") continue;
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = `${voice.name}${voice.type === "profile" ? " (perfil)" : voice.type === "openai_alias" ? " (voz predeterminada)" : ""}`;
      select.append(option);
    }
    if (![...select.options].some((option) => option.value === selected)) {
      const option = document.createElement("option");
      option.value = selected;
      option.textContent = selected;
      select.append(option);
    }
    select.value = selected;
    const profiles = (data.voices || []).filter((voice) => voice.type === "profile").length;
    status.textContent = `VoiceStudio conectado. ${profiles} perfiles propios. Las voces estándar como «shimmer» usan la voz predeterminada del motor activo. Pulsa «Probar voz».`;
  } catch (error) {
    status.textContent = error.message;
  }
}

function bindVoice() {
  $("#btn-voicestudio-voices").addEventListener("click", loadVoiceStudioVoices);
  $("#btn-tts-fast").addEventListener("click", async () => {
    try {
      await savePatch({ tts: { minIntervalMs: 100, maxQueue: 2, maxChars: 120 } });
      toast("Voz en tiempo real activada; se saltarán mensajes atrasados", "good");
    } catch (error) {
      toast(error.message, "bad");
    }
  });
  $("#btn-tts-replay").addEventListener("click", () => {
    if (store.lastTestAudio) enqueueAudio(store.lastTestAudio.url, store.lastTestAudio.volume);
  });
  $("#btn-tts-test").addEventListener("click", async () => {
    const text = $("#tts-preview-text").value.trim() || "Hola, esta es mi voz para el directo.";
    $("#tts-status").textContent = "Generando voz…";
    $("#btn-tts-replay").hidden = true;
    store.lastTestAudio = null;
    try {
      await api("/api/tts/test", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      clearTimeout(ttsStatusTimer);
      ttsStatusTimer = setTimeout(() => {
        if ($("#tts-status").textContent === "Generando voz…") {
          $("#tts-status").textContent = "La voz sigue cargando. El primer uso de VoiceStudio puede tardar; espera el resultado.";
        }
      }, 15000);
    } catch (error) {
      $("#tts-status").textContent = error.message;
      toast(error.message, "bad");
    }
  });
}

function handleTts(tts) {
  if (!tts) return;
  if (tts.kind === "test") {
    clearTimeout(ttsStatusTimer);
    store.lastTestAudio = { url: tts.url, volume: tts.volume };
    $("#btn-tts-replay").hidden = false;
    $("#tts-status").textContent = tts.fallbackFrom
      ? `${tts.fallbackFrom === "voicestudio" ? "VoiceStudio" : "Edge"} falló: ${tts.fallbackReason}. Zhezhi generó la voz con Windows; pulsa «Reproducir audio» si no la oyes.`
      : `Voz generada con ${tts.provider === "edge" ? "Edge" : tts.provider === "voicestudio" ? "VoiceStudio" : "Windows"}. Si no se escucha, pulsa «Reproducir audio».`;
  }
  if (store.listenHere || tts.kind === "test") {
    enqueueAudio(tts.url, tts.volume, tts.kind, tts.sourceAt);
  }
}

function updateAlertAudio(files) {
  if (!files) return;
  store.alertAudio = files;
  for (const kind of ["follow", "gift", "like"]) {
    const exists = Boolean(files[kind]);
    $(`#audio-${kind}-status`).textContent = exists ? "Audio cargado y listo." : "Sin audio cargado.";
    $(`[data-alert-play="${kind}"]`).disabled = !exists;
    $(`[data-alert-remove="${kind}"]`).disabled = !exists;
  }
}

function playAlertSound(sound) {
  if (paused || !sound?.url || !["follow", "gift", "like"].includes(sound.kind)) return;
  const audio = new Audio(sound.url);
  audio.volume = Math.min(1, Math.max(0, Number(sound.volume ?? 80) / 100));
  store.activeAlertSounds.add(audio);
  const cleanup = () => store.activeAlertSounds.delete(audio);
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  audio.play().catch(() => { cleanup(); if (!paused) toast("No pude reproducir la alerta. Haz clic en el panel y vuelve a probar.", "warn"); });
}

function updateAlertVideo(files) {
  if (!files) return;
  store.alertVideo = files;
  for (const kind of ["follow", "gift", "like"]) {
    const exists = Boolean(files[kind]);
    $(`#video-${kind}-status`).textContent = exists ? "Vídeo cargado y listo." : "Sin vídeo cargado.";
    $(`[data-video-play="${kind}"]`).disabled = !exists;
    $(`[data-video-remove="${kind}"]`).disabled = !exists;
  }
}

function bindAlertVideo() {
  for (const kind of ["follow", "gift", "like"]) {
    const input = $(`#video-${kind}-file`);
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 30 * 1024 * 1024) { toast("El vídeo supera los 30 MB", "bad"); input.value = ""; return; }
      try {
        const data = await api(`/api/alert-video/${kind}`, { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } });
        updateAlertVideo(data.video);
        toast("Vídeo guardado", "good");
      } catch (error) { toast(error.message, "bad"); }
      input.value = "";
    });
    $(`[data-video-play="${kind}"]`).addEventListener("click", () => {
      store.previewStop?.();
      const url = store.alertVideo[kind];
      if (url) store.previewStop = showAlertVideo(
        $("#video-preview"), url, $(`[data-setting="customVideo.chroma"]`).value,
        $(`[data-setting="customVideo.sound"]`).checked,
      );
    });
    $(`[data-video-remove="${kind}"]`).addEventListener("click", async () => {
      try {
        store.previewStop?.();
        const data = await api(`/api/alert-video/${kind}`, { method: "DELETE" });
        updateAlertVideo(data.video);
        toast("Vídeo quitado", "good");
      } catch (error) { toast(error.message, "bad"); }
    });
  }
  updateAlertVideo(store.alertVideo);
}

function bindAlertAudio() {
  for (const kind of ["follow", "gift", "like"]) {
    const input = $(`#audio-${kind}-file`);
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) {
        toast("El audio no puede superar los 12 MB", "bad");
        input.value = "";
        return;
      }
      input.disabled = true;
      $(`#audio-${kind}-status`).textContent = "Cargando audio…";
      try {
        const response = await fetch(`/api/alert-audio/${kind}`, {
          method: "POST",
          headers: { "X-Directo": "1", "Content-Type": "application/octet-stream" },
          body: file,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
        updateAlertAudio(data.audio);
        toast("Audio cargado", "good");
      } catch (error) {
        updateAlertAudio(store.alertAudio);
        toast(error.message, "bad");
      } finally {
        input.disabled = false;
        input.value = "";
      }
    });
    $(`[data-alert-play="${kind}"]`).addEventListener("click", () => {
      const url = store.alertAudio[kind];
      if (url) playAlertSound({ kind, url, volume: config?.customAudio?.volume });
    });
    $(`[data-alert-remove="${kind}"]`).addEventListener("click", async () => {
      try {
        const data = await api(`/api/alert-audio/${kind}`, { method: "DELETE" });
        updateAlertAudio(data.audio);
        toast("Audio quitado", "good");
      } catch (error) {
        toast(error.message, "bad");
      }
    });
  }
  updateAlertAudio(store.alertAudio);
}

function enqueueAudio(url, volume = 100, kind = "test", sourceAt = Date.now()) {
  if (paused && kind !== "test") return;
  if (["chat", "join", "like"].includes(kind) && Date.now() - sourceAt > 20000) return;
  if (kind === "chat") store.audioQueue = store.audioQueue.filter((item) => item.kind !== "chat");
  const item = { url, volume, kind, sourceAt };
  const firstChat = store.audioQueue.findIndex((queued) => queued.kind === "chat");
  store.audioQueue.splice(kind === "chat" || firstChat < 0 ? store.audioQueue.length : firstChat, 0, item);
  while (store.audioQueue.length > 4) {
    const chatIndex = store.audioQueue.findIndex((queued) => queued.kind === "chat");
    store.audioQueue.splice(chatIndex < 0 ? 0 : chatIndex, 1);
  }
  playNextAudio();
}

function playNextAudio() {
  if (store.audioPlaying || !store.audioQueue.length) return;
  const item = store.audioQueue.shift();
  if (["chat", "join", "like"].includes(item.kind) && Date.now() - item.sourceAt > 20000) {
    playNextAudio();
    return;
  }
  store.audioPlaying = true;
  const audio = new Audio(item.url);
  store.currentAudio = audio;
  audio.volume = Math.min(1, Math.max(0, Number(item.volume ?? 100) / 100));
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (store.currentAudio === audio) store.currentAudio = null;
    // Deja respirar la última sílaba antes de que la siguiente voz la tape.
    setTimeout(() => {
      store.audioPlaying = false;
      playNextAudio();
    }, audio.ended ? 250 : 0);
  };
  audio.addEventListener("ended", finish);
  audio.addEventListener("error", () => {
    if (store.lastTestAudio?.url === item.url) $("#tts-status").textContent = "El navegador no pudo abrir el audio. Prueba «Reproducir audio» o revisa la salida de sonido de Windows.";
    finish();
  });
  audio.play().catch((error) => {
    if (store.lastTestAudio?.url === item.url) {
      $("#tts-status").textContent = `El navegador bloqueó la reproducción (${error.name}). Haz clic en «Reproducir audio».`;
    }
    finish();
  });
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

function renderOverlayUrls() {
  $("#url-full").value = overlayUrls.full || "";
  $("#url-alerts").value = overlayUrls.alerts || "";
  $("#url-chat").value = overlayUrls.chat || "";
  $("#url-clean").value = overlayUrls.clean || "";
  $("#url-likes").value = overlayUrls.likes || "";
  $("#url-goal").value = overlayUrls.goal || "";
  $("#url-goal-inline").value = overlayUrls.goal || "";
  $("#url-top-both").value = overlayUrls.topBoth || "";
  $("#url-top-likes").value = overlayUrls.topLikes || "";
  $("#url-top-gifts").value = overlayUrls.topGifts || "";
}

function bindOverlay() {
  for (const button of $$("[data-copy]")) {
    button.addEventListener("click", () => {
      const input = $(`#${button.dataset.copy}`);
      if (input) copyText(input.value);
    });
  }
  for (const button of $$("[data-open-overlay]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.openOverlay;
      const url = overlayUrls[key] || overlayUrls.full;
      if (url) window.open(url, "_blank", "noopener");
    });
  }

  const presets = {
    classic: {
      alertsPosition: "top-center",
      chatPosition: "bottom-left",
      captionsPosition: "bottom-center",
      scale: 1,
      safeArea: 24,
      alertsWidth: 600,
      chatWidth: 450,
      chatSize: 15,
      alertNameSize: 25,
      captionSize: 21,
    },
    clean: {
      alertsPosition: "top-right",
      chatPosition: "bottom-left",
      captionsPosition: "bottom-center",
      scale: 0.92,
      safeArea: 20,
      alertsWidth: 540,
      chatWidth: 400,
      chatSize: 14,
      alertNameSize: 22,
      captionSize: 19,
    },
    compact: {
      alertsPosition: "top-right",
      chatPosition: "bottom-left",
      captionsPosition: "bottom-center",
      scale: 0.82,
      safeArea: 16,
      alertsWidth: 460,
      chatWidth: 340,
      chatSize: 12,
      alertNameSize: 19,
      captionSize: 16,
    },
    show: {
      alertsPosition: "top-center",
      chatPosition: "bottom-left",
      captionsPosition: "bottom-center",
      scale: 1.15,
      safeArea: 34,
      alertsWidth: 680,
      chatWidth: 520,
      chatSize: 17,
      alertNameSize: 28,
      captionSize: 24,
    },
  };

  for (const button of $$("[data-preset]")) {
    button.addEventListener("click", async () => {
      const preset = presets[button.dataset.preset];
      if (!preset) return;
      try {
        await savePatch({ overlay: preset });
        toast(`Disposición «${button.textContent.trim()}» aplicada`, "good");
      } catch (error) {
        toast(error.message, "bad");
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Navegación                                                          */
/* ------------------------------------------------------------------ */

function setView(name) {
  if (!config && name !== "connect") return;
  if (!$(`#view-${name}`)) return;
  activeView = name;
  for (const button of $$(".nav-item")) {
    const active = button.dataset.view === name;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    if (active && window.matchMedia("(max-width: 900px)").matches) {
      const nav = $(".nav");
      nav.scrollTo({ left: button.offsetLeft - (nav.clientWidth - button.clientWidth) / 2, behavior: "smooth" });
    }
  }
  for (const view of $$(".view")) {
    view.classList.toggle("is-active", view.id === `view-${name}`);
  }
  localStorage.setItem("zhezhi.view", name);
  if (name === "summary") loadSummary(false);
  if (name === "minecraft") refreshMinecraftStatus();
  if (name === "voice" && !$("#tts-voice").options.length) loadVoices();
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
}

function initialView() {
  const hash = location.hash.replace("#", "");
  if (hash && $(`#view-${hash}`)) return hash;
  const saved = localStorage.getItem("zhezhi.view");
  if (saved && $(`#view-${saved}`)) return saved;
  return "connect";
}

function bindNav() {
  const nav = $(".nav");
  const updateArrows = () => {
    for (const arrow of $$(".nav-carousel-arrow")) {
      arrow.disabled = arrow.dataset.navDirection === "previous"
        ? nav.scrollLeft <= 1
        : nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 1;
    }
  };
  for (const arrow of $$(".nav-carousel-arrow")) {
    arrow.addEventListener("click", () => nav.scrollBy({
      left: (arrow.dataset.navDirection === "next" ? 1 : -1) * nav.clientWidth * 0.75,
      behavior: "smooth",
    }));
  }
  nav.addEventListener("scroll", updateArrows, { passive: true });
  window.addEventListener("resize", updateArrows);
  updateArrows();
  for (const button of $$(".nav-item")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  window.addEventListener("hashchange", () => {
    const name = location.hash.replace("#", "");
    if (name && $(`#view-${name}`) && name !== activeView) setView(name);
  });
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

function toast(text, level = "") {
  const node = document.createElement("div");
  node.className = `toast ${level}`.trim();
  node.textContent = text;
  $("#toasts").append(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .25s";
    setTimeout(() => node.remove(), 260);
  }, 4500);
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

async function init() {
  bindNav();
  bindSettings();
  bindConnection();
  bindDemo();
  bindChat();
  bindRules();
  bindSecrets();
  bindVoice();
  bindAlertAudio();
  bindAlertVideo();
  bindMobRules();
  bindOverlay();
  bindModeration();
  bindPause();
  bindBackup();

  $("#btn-summary").addEventListener("click", () => loadSummary(false));
  $("#btn-summary-ai").addEventListener("click", () => loadSummary(true));
  $("#btn-summary-ai-close").addEventListener("click", () => {
    $("#summary-ai-card").hidden = true;
  });

  $("#tts-provider").addEventListener("change", (event) => {
    updateVoiceControls();
    if (event.target.value === "voicestudio") loadVoiceStudioVoices();
  });
  $("#reply-mode").addEventListener("change", () => {
    if (config) {
      config.reply.mode = $("#reply-mode").value;
      syncSettings();
    }
  });

  try {
    const data = await api("/api/state");
    applyState(data);
  } catch (error) {
    toast(`No pude hablar con el servidor: ${error.message}`, "bad");
  }

  setView(initialView());
  connectWs();
  loadVoices();

  updateVoiceControls();
  if (config?.tts.provider === "voicestudio") loadVoiceStudioVoices();

  setTimeout(() => {
    if (activeView === "summary") loadSummary(false);
  }, 500);

  setInterval(() => {
    if (activeView === "summary") loadSummary(false);
  }, 25_000);
}

init();
