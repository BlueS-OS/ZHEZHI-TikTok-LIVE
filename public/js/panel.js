const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const store = {
  listenHere: localStorage.getItem("zhezhi.listenHere") !== "0",
  audioQueue: [],
  audioPlaying: false,
  lastTestAudio: null,
  alertAudio: { follow: null, gift: null },
};

let config = null;
let status = { state: "idle" };
let stats = null;
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
  events = (data.events || []).slice();
  suggestions = (data.suggestions || []).slice();
  reasonLabels = data.reasons || {};
  overlayUrls = data.overlayUrls || {};
  updateAlertAudio(data.alertAudio);
  syncSettings();
  renderStatus();
  renderStats();
  scheduleFeedRender();
  renderSuggestions();
  renderOverlayUrls();
  updateDemoUi(Boolean(data.demo));
  $("#version-label").textContent = data.version || "0.1.4";
  $("#node-label").textContent = data.node || "—";
  const base = overlayUrls.full ? overlayUrls.full.replace("overlay.html", "") : `${location.origin}/`;
  $("#overlay-base").textContent = base;
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
          body: JSON.stringify({ kind: chip.dataset.demo }),
        });
      } catch (error) {
        toast(error.message, "bad");
      }
    });
  }
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
  $("#btn-demo").textContent = active ? "Parar demo" : "Modo demo";
  $("#btn-demo").classList.toggle("primary", active);
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
  $("#chat-autoscroll").addEventListener("change", () => renderFeed());
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
  for (const kind of ["follow", "gift"]) {
    const exists = Boolean(files[kind]);
    $(`#audio-${kind}-status`).textContent = exists ? "Audio cargado y listo." : "Sin audio cargado.";
    $(`[data-alert-play="${kind}"]`).disabled = !exists;
    $(`[data-alert-remove="${kind}"]`).disabled = !exists;
  }
}

function playAlertSound(sound) {
  if (!sound?.url || !["follow", "gift"].includes(sound.kind)) return;
  const audio = new Audio(sound.url);
  audio.volume = Math.min(1, Math.max(0, Number(sound.volume ?? 80) / 100));
  audio.play().catch(() => toast("No pude reproducir la alerta. Haz clic en el panel y vuelve a probar.", "warn"));
}

function bindAlertAudio() {
  for (const kind of ["follow", "gift"]) {
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
  if (kind === "chat" && Date.now() - sourceAt > 20000) return;
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
  if (item.kind === "chat" && Date.now() - item.sourceAt > 20000) {
    playNextAudio();
    return;
  }
  store.audioPlaying = true;
  const audio = new Audio(item.url);
  audio.volume = Math.min(1, Math.max(0, Number(item.volume ?? 100) / 100));
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
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
}

/* ------------------------------------------------------------------ */
/* Navegación                                                          */
/* ------------------------------------------------------------------ */

function setView(name) {
  if (!config && name !== "connect") return;
  activeView = name;
  for (const button of $$(".nav-item")) {
    button.classList.toggle("is-active", button.dataset.view === name);
  }
  for (const view of $$(".view")) {
    view.classList.toggle("is-active", view.id === `view-${name}`);
  }
  if (name === "summary") loadSummary(false);
  if (name === "voice" && !$("#tts-voice").options.length) loadVoices();
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
}

function bindNav() {
  for (const button of $$(".nav-item")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  const initial = location.hash.replace("#", "");
  if (initial && $(`#view-${initial}`)) setView(initial);
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
  bindOverlay();
  bindModeration();

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
