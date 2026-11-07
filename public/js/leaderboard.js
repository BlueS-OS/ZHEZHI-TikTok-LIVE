const board = new URLSearchParams(location.search).get("board");
if (board === "likes" || board === "gifts") document.body.classList.add(`only-${board}`);

const icons = { likes: "♥", gifts: "◆" };
const lists = { likes: document.querySelector("#top-likes"), gifts: document.querySelector("#top-gifts") };
const previous = { likes: "", gifts: "" };
let retries = 0;

function render(kind, viewers = []) {
  const entries = Array.isArray(viewers) ? viewers.slice(0, 5) : [];
  const signature = JSON.stringify(entries);
  if (previous[kind] === signature) return;
  previous[kind] = signature;
  const list = lists[kind];
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = kind === "likes" ? "Esperando corazones…" : "Esperando regalos…";
    list.replaceChildren(empty);
    return;
  }
  const rows = entries.map((viewer, index) => {
    const row = document.createElement("li");
    row.className = `rank rank-${index + 1}`;
    const position = document.createElement("span");
    position.className = "position";
    position.textContent = index === 0 ? "♛" : String(index + 1);
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = (viewer.name || "?").slice(0, 1).toUpperCase();
    try {
      const url = new URL(viewer.avatar);
      if (["https:", "http:"].includes(url.protocol)) {
        const image = document.createElement("img");
        image.src = url.href;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => image.remove());
        avatar.append(image);
      }
    } catch { /* Sin foto: inicial del usuario. */ }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = viewer.name || "alguien";
    const score = document.createElement("span");
    score.className = "score";
    const icon = document.createElement("span");
    icon.textContent = icons[kind];
    const amount = document.createElement("span");
    amount.textContent = Math.max(0, Number(kind === "likes" ? viewer.count : viewer.diamonds) || 0).toLocaleString("es-ES");
    score.append(icon, amount);
    row.append(position, avatar, name, score);
    return row;
  });
  list.replaceChildren(...rows);
}

function update(stats) {
  if (!stats) return;
  render("likes", stats.topLikers);
  render("gifts", stats.topGifters);
}

async function load() {
  try {
    const response = await fetch("/api/state", { headers: { "X-Directo": "1" } });
    if (response.ok) update((await response.json()).stats);
  } catch { /* Conserva el último estado hasta reconectar. */ }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws?role=overlay`);
  ws.addEventListener("open", () => { retries = 0; load(); });
  ws.addEventListener("message", (message) => {
    let data;
    try { data = JSON.parse(message.data); } catch { return; }
    if (data.type === "stats") update(data.stats);
    if (data.type === "reset") update({ topLikers: [], topGifters: [] });
  });
  ws.addEventListener("close", () => {
    const delay = Math.min(9000, 700 + retries * 800);
    retries += 1;
    setTimeout(connect, delay);
  });
}

if (new URLSearchParams(location.search).get("preview") === "1") {
  update({
    topLikers: [
      { name: "Luna 91", count: 465 },
      { name: "Mari gamer", count: 287 },
      { name: "Óscar", count: 208 },
    ],
    topGifters: [
      { name: "ElTioPaco", diamonds: 59 },
      { name: "Pixelada", diamonds: 25 },
      { name: "Nocturno", diamonds: 10 },
    ],
  });
} else {
  load();
  connect();
}
