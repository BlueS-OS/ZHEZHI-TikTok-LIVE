const total = document.querySelector("#likes-total");
const last = document.querySelector("#likes-last");
let retries = 0;

function showCount(value) {
  total.textContent = Math.max(0, Number(value) || 0).toLocaleString("es-ES");
}

async function loadCount() {
  try {
    const response = await fetch("/api/state", { headers: { "X-Directo": "1" } });
    if (response.ok) showCount((await response.json()).stats.likes);
  } catch {
    // Conserva el último valor mientras se reconecta.
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws?role=overlay`);
  ws.addEventListener("open", () => { retries = 0; loadCount(); });
  ws.addEventListener("message", (message) => {
    let data;
    try { data = JSON.parse(message.data); } catch { return; }
    if (data.type === "stats") showCount(data.stats?.likes);
    if (data.type === "event" && data.event?.kind === "like") {
      last.textContent = `Último: ${data.event.user?.name || "alguien"}`;
    }
    if (data.type === "reset") {
      showCount(0);
      last.textContent = "Esperando el primer «me gusta»";
    }
  });
  ws.addEventListener("close", () => {
    const delay = Math.min(9000, 700 + retries * 800);
    retries += 1;
    setTimeout(connect, delay);
  });
}

loadCount();
connect();
