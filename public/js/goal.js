const $ = (selector) => document.querySelector(selector);
const preview = new URLSearchParams(location.search).get("preview") === "1";
if (preview) document.body.classList.add("preview");

const KINDS = {
  followers: { label: "Seguidores", icon: "＋", goal: "follows" },
  likes: { label: "Me gusta", icon: "♥", goal: "likes" },
  diamonds: { label: "Diamantes", icon: "◆", goal: "diamonds" },
};

const SAMPLE = {
  config: {
    goals: { enabled: true, label: "Meta del directo", followers: 100, likes: 5000, diamonds: 500 },
    overlay: { performance: false },
  },
  stats: {
    startedAt: Date.now() - 47 * 60 * 1000 - 21 * 1000,
    follows: 64,
    likes: 3210,
    diamonds: 182,
  },
};

let config = { goals: { enabled: true, label: "Meta del directo", followers: 0, likes: 0, diamonds: 0 }, overlay: {} };
let stats = null;
let retries = 0;
const cards = new Map();

const numberFormat = new Intl.NumberFormat("es-ES");

function format(value) {
  return numberFormat.format(Math.max(0, Number(value) || 0));
}

function hasGoals(goals) {
  return Boolean(goals?.enabled) && ["followers", "likes", "diamonds"].some((kind) => Number(goals[kind]) > 0);
}

function effectiveGoals() {
  const goals = config.goals || {};
  if (preview && !hasGoals(goals)) return SAMPLE.config.goals;
  return goals;
}

function buildCards() {
  const grid = $("#goals-grid");
  grid.replaceChildren();
  cards.clear();

  for (const [kind, info] of Object.entries(KINDS)) {
    const card = document.createElement("section");
    card.className = "goal-card";
    card.dataset.kind = kind;
    card.setAttribute("aria-label", info.label);

    const head = document.createElement("div");
    head.className = "goal-head";
    const icon = document.createElement("span");
    icon.className = "goal-icon";
    icon.textContent = info.icon;
    const label = document.createElement("span");
    label.className = "goal-label";
    label.textContent = info.label;
    head.append(icon, label);

    const values = document.createElement("div");
    values.className = "goal-values";
    const current = document.createElement("strong");
    current.className = "goal-current";
    current.textContent = "0";
    const target = document.createElement("span");
    target.className = "goal-target";
    target.textContent = "/ 0";
    values.append(current, target);

    const track = document.createElement("div");
    track.className = "goal-track";
    const fill = document.createElement("span");
    fill.className = "goal-fill";
    track.append(fill);

    const foot = document.createElement("div");
    foot.className = "goal-foot";
    const remaining = document.createElement("span");
    const percent = document.createElement("strong");
    foot.append(remaining, percent);

    card.append(head, values, track, foot);
    grid.append(card);
    cards.set(kind, { card, current, target, fill, remaining, percent });
  }
}

function updateClock() {
  const startedAt = Number(stats?.startedAt || 0);
  const total = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  $("#session-clock").textContent = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function update() {
  const goals = effectiveGoals();
  const show = hasGoals(goals);
  $("#goals").classList.toggle("is-empty", !show);
  $("#goals-title").textContent = goals.label || "Meta del directo";

  let visible = 0;
  for (const [kind, info] of Object.entries(KINDS)) {
    const entry = cards.get(kind);
    const targetValue = Math.max(0, Number(goals[kind]) || 0);
    if (targetValue <= 0) {
      entry.card.hidden = true;
      continue;
    }
    entry.card.hidden = false;
    visible += 1;

    const currentValue = Math.max(0, Number(stats?.[info.goal]) || 0);
    const percentValue = Math.min(100, (currentValue / targetValue) * 100);
    entry.current.textContent = format(currentValue);
    entry.target.textContent = `/ ${format(targetValue)}`;
    entry.fill.style.width = `${percentValue}%`;
    entry.remaining.textContent = currentValue >= targetValue
      ? "Meta alcanzada · gracias"
      : `Faltan ${format(targetValue - currentValue)}`;
    entry.percent.textContent = `${Math.floor(percentValue)}%`;
    entry.card.classList.toggle("is-complete", currentValue >= targetValue);
  }

  $("#goals").classList.toggle("is-empty", visible === 0 || !show);
  updateClock();
}

function applyConfig(next) {
  if (!next) return;
  config = next;
  document.body.classList.toggle("performance", Boolean(config.overlay?.performance));
  update();
}

async function load() {
  try {
    const response = await fetch("/api/state", { headers: { "X-Directo": "1" } });
    if (response.ok) {
      const data = await response.json();
      applyConfig(data.config);
      stats = preview ? SAMPLE.stats : data.stats;
      update();
    }
  } catch {
    if (preview) {
      applyConfig(SAMPLE.config);
      stats = SAMPLE.stats;
      update();
    }
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws?role=overlay`);
  ws.addEventListener("open", () => { retries = 0; });
  ws.addEventListener("message", (message) => {
    let data;
    try { data = JSON.parse(message.data); } catch { return; }
    if (data.type === "settings") applyConfig(data.config);
    if (preview) return;
    if (data.type === "stats") {
      stats = data.stats;
      update();
    }
    if (data.type === "reset") {
      stats = null;
      update();
    }
  });
  ws.addEventListener("close", () => {
    const delay = Math.min(9000, 700 + retries * 800);
    retries += 1;
    setTimeout(connect, delay);
  });
}

buildCards();
if (preview) {
  applyConfig(SAMPLE.config);
  stats = SAMPLE.stats;
  update();
}
load();
connect();
setInterval(updateClock, 1000);
