const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const preview = params.get("preview") === "1";

let config = {
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
  alerts: { follow: true, subscribe: true, gift: true, like: true, share: false },
  customAudio: { enabled: false, follow: true, gift: true, like: true, volume: 80 },
};

let ws = null;
let wsRetry = 0;
const alertQueue = [];
let alertBusy = false;
const ttsQueue = [];
let ttsPlaying = false;
let ttsFinishing = false;
let captionTimer = null;
let audioContext = null;
let alertAudio = { follow: null, gift: null };
const soundQueue = [];
let soundPlaying = false;

const audio = $("#player");
const alertPlayer = $("#alert-player");

if (preview) document.body.classList.add("preview");

for (const key of ["chat", "alerts", "captions"]) {
  if (params.has(key) && params.get(key) === "0") {
    document.body.classList.add(`hide-${key}`);
  }
}

function forced(key) {
  if (!params.has(key)) return null;
  return params.get(key) !== "0";
}

function visible(key) {
  return forced(key) ?? Boolean(config.overlay[key]);
}

function applyConfig(next) {
  if (!next) return;
  config = next;
  document.body.classList.toggle("hide-alerts", !visible("alerts"));
  document.body.classList.toggle("hide-chat", !visible("chat"));
  document.body.classList.toggle("hide-captions", !visible("captions"));
  trimChat();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/state", { headers: { "X-Directo": "1" } });
    if (response.ok) {
      const data = await response.json();
      applyConfig(data.config);
      alertAudio = data.alertAudio || alertAudio;
    }
  } catch {
    // Seguimos con los valores por defecto.
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws?role=overlay`);

  ws.addEventListener("open", () => {
    wsRetry = 0;
  });

  ws.addEventListener("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.data);
    } catch {
      return;
    }
    if (data.type === "event") handleEvent(data.event);
    else if (data.type === "settings") applyConfig(data.config);
    else if (data.type === "tts") enqueueTts(data.tts);
    else if (data.type === "alert-sound") enqueueAlertSound(data);
    else if (data.type === "alert-audio-files") alertAudio = data.audio;
    else if (data.type === "reset") reset();
  });

  ws.addEventListener("close", () => {
    const delay = Math.min(9000, 700 + wsRetry * 800);
    wsRetry += 1;
    setTimeout(connect, delay);
  });
}

function reset() {
  $("#chat").innerHTML = "";
  alertQueue.length = 0;
  ttsQueue.length = 0;
  soundQueue.length = 0;
  hideCaption();
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

function hash(text) {
  let value = 0;
  for (const char of String(text)) value = (value * 31 + char.charCodeAt(0)) % 1000;
  return value;
}

function addChatLine(event) {
  if (!visible("chat")) return;
  const line = document.createElement("div");
  line.className = "chat-line";
  if (event.kind === "question") line.classList.add("is-question");
  if (event.kind === "join") line.classList.add("is-join");
  if (event.kind === "like") line.classList.add("is-like");

  const who = document.createElement("span");
  who.className = "who";
  who.textContent = event.user?.name || "alguien";
  who.style.setProperty("--hue", String(hash(event.user?.name || "alguien") % 360));

  const what = document.createElement("span");
  what.className = "what";

  if (event.kind === "join") what.textContent = "ha entrado";
  else if (event.kind === "like") {
    what.textContent = `❤️ +${event.count || 0} · ${Number(event.total || 0).toLocaleString("es-ES")} en total`;
  } else if (event.kind === "question") {
    what.textContent = `❓ ${event.text}`;
  } else {
    what.textContent = event.text;
  }

  line.append(who, what);
  $("#chat").append(line);
  trimChat();
}

function trimChat() {
  const max = Math.max(1, Number(config.overlay.chatMax) || 12);
  const lines = [...$("#chat").children];
  for (const line of lines.slice(0, Math.max(0, lines.length - max))) {
    line.remove();
  }
}

/* ------------------------------------------------------------------ */
/* Alertas                                                             */
/* ------------------------------------------------------------------ */

function handleEvent(event) {
  if (!event) return;
  switch (event.kind) {
    case "chat":
    case "question":
      if (!event.hidden) addChatLine(event);
      break;
    case "join":
      if (config.overlay.showJoins) addChatLine(event);
      break;
    case "like":
      if (config.overlay.showLikes) addChatLine(event);
      if (visible("alerts") && config.alerts.like) pushAlert("like", event);
      break;
    case "gift":
      if (
        visible("alerts") &&
        config.alerts.gift &&
        Number(event.diamonds || 0) >= Number(config.overlay.giftMinDiamonds || 0)
      ) {
        pushAlert("gift", event);
      }
      break;
    case "follow":
      if (visible("alerts") && config.alerts.follow) pushAlert("follow", event);
      break;
    case "subscribe":
      if (visible("alerts") && config.alerts.subscribe) pushAlert("subscribe", event);
      break;
    case "share":
      if (visible("alerts") && config.alerts.share) pushAlert("share", event);
      break;
    default:
      break;
  }
}

function pushAlert(kind, event) {
  if (alertQueue.length >= 8) alertQueue.shift();
  alertQueue.push({ kind, event });
  runAlerts();
}

async function runAlerts() {
  if (alertBusy) return;
  alertBusy = true;
  while (alertQueue.length) {
    const item = alertQueue.shift();
    await showAlert(item);
  }
  alertBusy = false;
}

function showAlert({ kind, event }) {
  return new Promise((resolve) => {
    const duration = kind === "like" ? 2000 : Math.max(2000, Number(config.overlay.durationMs) || 6000);
    const card = document.createElement("div");
    card.className = `alert alert-${kind}`;
    card.style.setProperty("--dur", `${duration}ms`);

    const art = document.createElement("div");
    art.className = `alert-art${kind === "gift" ? " is-gift" : ""}`;
    const image =
      kind === "gift" ? event.gift?.image : event.user?.avatar;
    const emoji = kind === "gift" ? "🎁" : kind === "follow" ? "💛" : kind === "subscribe" ? "⭐" : kind === "like" ? "❤️" : "🔁";
    if (image) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        img.remove();
        art.textContent = emoji;
      });
      art.append(img);
    } else {
      art.textContent = emoji;
    }

    const copy = document.createElement("div");
    copy.className = "alert-copy";

    const eyebrow = document.createElement("div");
    eyebrow.className = "alert-eyebrow";
    eyebrow.textContent =
      kind === "gift" ? "Regalo" : kind === "follow" ? "Nuevo seguidor" : kind === "subscribe" ? "Nueva suscripción" : kind === "like" ? "Me gusta" : "Ha compartido";

    const name = document.createElement("div");
    name.className = "alert-name";
    name.textContent = event.user?.name || "Alguien";

    const detail = document.createElement("div");
    detail.className = "alert-detail";
    if (kind === "gift") {
      const strong = document.createElement("strong");
      strong.textContent = `${event.gift?.name || "Regalo"}${event.count > 1 ? ` ×${event.count}` : ""}`;
      detail.append(strong);
      if (event.diamonds > 0) detail.append(document.createTextNode(` · ${event.diamonds} diamantes`));
    } else if (kind === "subscribe") {
      detail.textContent = event.months > 1 ? `Se queda ${event.months} meses` : "Gracias por suscribirte";
    } else if (kind === "follow") {
      detail.textContent = "Gracias por seguir el directo";
    } else if (kind === "like") {
      detail.textContent = event.count > 1 ? `${event.count} me gusta` : "Le gusta el directo";
    } else {
      detail.textContent = "Gracias por difundirlo";
    }

    const progress = document.createElement("div");
    progress.className = "alert-progress";

    copy.append(eyebrow, name, detail);
    card.append(art, copy, progress);
    $("#alerts").append(card);

    if (!(config.customAudio?.enabled && config.customAudio[kind] && alertAudio[kind])) beep(kind);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("in")));

    setTimeout(() => {
      card.classList.add("out");
      setTimeout(() => {
        card.remove();
        resolve();
      }, 320);
    }, duration);
  });
}

/* ------------------------------------------------------------------ */
/* Sonido                                                              */
/* ------------------------------------------------------------------ */

function beep(kind) {
  if (preview || !config.overlay.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
    const notes =
      kind === "gift"
        ? [523.25, 659.25, 783.99, 1046.5]
        : kind === "like"
          ? [659.25, 880]
        : kind === "subscribe"
          ? [523.25, 698.46, 880]
          : kind === "follow"
            ? [440, 659.25]
            : [392, 523.25];
    const now = audioContext.currentTime;
    notes.forEach((frequency, index) => {
      const start = now + index * 0.085;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.32);
    });
  } catch {
    // Sin audio, la alerta sigue funcionando.
  }
}

function enqueueAlertSound(sound) {
  if (preview || !["follow", "gift", "like"].includes(sound.kind) || !sound.url) return;
  if (soundQueue.length >= 4) soundQueue.shift();
  soundQueue.push(sound);
  playNextAlertSound();
}

function playNextAlertSound() {
  if (soundPlaying || !soundQueue.length) return;
  soundPlaying = true;
  const sound = soundQueue.shift();
  alertPlayer.src = sound.url;
  alertPlayer.volume = Math.min(1, Math.max(0, Number(sound.volume ?? 80) / 100));
  alertPlayer.play().catch(() => {
    soundPlaying = false;
    playNextAlertSound();
  });
}

for (const type of ["ended", "error"]) {
  alertPlayer.addEventListener(type, () => {
    soundPlaying = false;
    playNextAlertSound();
  });
}

/* ------------------------------------------------------------------ */
/* Voz y subtítulos                                                    */
/* ------------------------------------------------------------------ */

function enqueueTts(tts) {
  if (!tts) return;
  if (["chat", "join", "like"].includes(tts.kind) && Date.now() - (tts.sourceAt || Date.now()) > 20000) return;
  if (preview) {
    showCaption(tts);
    captionTimer = setTimeout(hideCaption, 2800);
    return;
  }
  if (tts.kind === "chat") {
    for (let i = ttsQueue.length - 1; i >= 0; i -= 1) {
      if (ttsQueue[i].kind === "chat") ttsQueue.splice(i, 1);
    }
    ttsQueue.push(tts);
  } else {
    const firstChat = ttsQueue.findIndex((item) => item.kind === "chat");
    ttsQueue.splice(firstChat < 0 ? ttsQueue.length : firstChat, 0, tts);
  }
  while (ttsQueue.length > 4) {
    const chatIndex = ttsQueue.findIndex((item) => item.kind === "chat");
    ttsQueue.splice(chatIndex < 0 ? 0 : chatIndex, 1);
  }
  playNextTts();
}

function playNextTts() {
  if (ttsPlaying || !ttsQueue.length) return;
  const tts = ttsQueue.shift();
  if (["chat", "join", "like"].includes(tts.kind) && Date.now() - (tts.sourceAt || Date.now()) > 20000) {
    playNextTts();
    return;
  }
  ttsPlaying = true;
  ttsFinishing = false;
  audio.src = tts.url;
  audio.volume = Math.min(1, Math.max(0, Number(tts.volume ?? 100) / 100));
  showCaption(tts);
  audio.play().catch(() => finishTts());
}

function finishTts() {
  if (!ttsPlaying || ttsFinishing) return;
  ttsFinishing = true;
  // No iniciar otra voz en el mismo instante en que acaba la sílaba final.
  setTimeout(() => {
    ttsPlaying = false;
    captionTimer = setTimeout(hideCaption, 900);
    playNextTts();
  }, audio.ended ? 250 : 0);
}

audio.addEventListener("ended", finishTts);
audio.addEventListener("error", finishTts);

function showCaption(tts) {
  if (!visible("captions")) return;
  clearTimeout(captionTimer);
  $("#caption-user").textContent = tts.user || "";
  $("#caption-text").textContent = tts.caption || tts.text || "";
  $("#captions").classList.add("in");
}

function hideCaption() {
  $("#captions").classList.remove("in");
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

loadConfig();
connect();
