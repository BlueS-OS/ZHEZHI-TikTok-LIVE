const layer = document.querySelector("#interaction-layer");
const board = document.querySelector("#interaction-vote-board");
let settings = null;
let votes = { a: 0, b: 0 };
let timer = null;
let audioContext = null;

export function setInteractionConfig(config) {
  settings = config;
  renderVotes();
  if (!config?.enabled) clearInteractions();
}

export function setVotes(next) {
  votes = next || { a: 0, b: 0 };
  renderVotes();
}

function renderVotes() {
  board.replaceChildren();
  board.hidden = !settings?.enabled || !settings.comments;
  if (board.hidden) return;
  const title = document.createElement("strong");
  title.textContent = "TU VOTO DECIDE";
  board.append(title);
  const total = Math.max(1, (Number(votes.a) || 0) + (Number(votes.b) || 0));
  for (const [key, label] of [["a", settings.optionA], ["b", settings.optionB]]) {
    const count = Math.max(0, Number(votes[key]) || 0);
    const row = document.createElement("div");
    row.className = "interaction-vote-row";
    const text = document.createElement("span");
    text.textContent = `!${key} · ${label || key.toUpperCase()} · ${count}`;
    const bar = document.createElement("span");
    bar.className = "interaction-vote-bar";
    bar.style.width = `${Math.round(count / total * 100)}%`;
    row.append(text, bar);
    board.append(row);
  }
}

function chime(kind) {
  if (!settings?.sound || document.body.classList.contains("preview")) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
    for (const [index, frequency] of (kind === "gift" ? [523, 784, 1047] : [660, 880]).entries()) {
      const time = audioContext.currentTime + index * 0.1;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.035, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.26);
    }
  } catch { /* Los efectos visuales funcionan sin audio. */ }
}

export function showInteraction(item) {
  if (!settings?.enabled || !item) return;
  if (item.kind === "vote") { setVotes(item.votes); return; }
  if ((item.kind === "likes" && !settings.likes) || (item.kind === "gift" && !settings.gifts)) return;
  clearTimeout(timer);
  layer.replaceChildren();
  const effect = document.createElement("div");
  effect.className = `interaction-effect interaction-${item.kind}`;
  const label = document.createElement("strong");
  label.textContent = item.kind === "gift" ? "◆ ¡REGALO ESPECIAL! ◆" : "♥ LLUVIA DE CORAZONES ♥";
  const name = document.createElement("span");
  name.textContent = item.name || "La comunidad";
  effect.append(label, name);
  for (let i = 0; i < 22; i += 1) {
    const particle = document.createElement("span");
    particle.className = "interaction-particle";
    particle.textContent = item.kind === "gift" ? ["✦", "◆", "✧"][i % 3] : "♥";
    particle.style.setProperty("--x", `${(i * 47) % 100}%`);
    particle.style.setProperty("--delay", `${(i * 83) % 600}ms`);
    particle.style.setProperty("--duration", `${1200 + (i * 101) % 1000}ms`);
    effect.append(particle);
  }
  layer.append(effect);
  chime(item.kind);
  timer = setTimeout(() => layer.replaceChildren(), 3500);
}

export function clearInteractions() {
  clearTimeout(timer);
  layer.replaceChildren();
}
