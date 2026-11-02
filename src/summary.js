import { looksLikeQuestion } from "./moderation.js";

const STOPWORDS = new Set(
  "para como esta estas estoy pero porque cuando donde quien sobre todo todos toda todas hace haces hacer eres estas tengo tienes hay muy mas menos este esta estos estas eso esa esos esas aqui alli ahora luego despues antes bien mal guapo guapa gracias hola buenas directo stream tiktok puedes podrias quiero quieres saber dime decir jugar juegas juego tambien solo eres ser ver vamos".split(
    " ",
  ),
);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function buildSummary(events, opts = {}) {
  const now = opts.now || Date.now();
  const windowMinutes = Math.max(1, Number(opts.windowMinutes) || 10);
  const since = now - windowMinutes * 60_000;
  const recent = (events || []).filter((e) => e.at >= since);
  const chat = recent.filter((e) => e.kind === "chat" && !e.hidden);
  const visibleChat = recent.filter((e) => e.kind === "chat");

  const users = new Map();
  const words = new Map();
  for (const event of chat) {
    const name = event.user?.name || "alguien";
    users.set(name, (users.get(name) || 0) + 1);
    for (const token of tokenize(event.text)) {
      if (token.length < 4 || STOPWORDS.has(token)) continue;
      words.set(token, (words.get(token) || 0) + 1);
    }
  }

  const questions = [];
  const seen = new Set();
  for (const event of chat) {
    if (!looksLikeQuestion(event.text)) continue;
    const key = String(event.text).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push({ name: event.user?.name || "alguien", text: event.text, at: event.at });
    if (questions.length >= 8) break;
  }

  const gifters = new Map();
  let diamonds = 0;
  let gifts = 0;
  for (const event of recent) {
    if (event.kind !== "gift") continue;
    gifts += 1;
    diamonds += Number(event.diamonds) || 0;
    const name = event.user?.name || "alguien";
    const current = gifters.get(name) || { name, diamonds: 0, count: 0 };
    current.diamonds += Number(event.diamonds) || 0;
    current.count += 1;
    gifters.set(name, current);
  }

  const follows = recent.filter((e) => e.kind === "follow").length;
  const subs = recent.filter((e) => e.kind === "subscribe").length;

  return {
    generatedAt: now,
    windowMinutes,
    totals: {
      messages: visibleChat.length,
      visibleMessages: chat.length,
      hidden: visibleChat.length - chat.length,
      activeUsers: users.size,
      perMinute: Math.round((visibleChat.length / windowMinutes) * 10) / 10,
      follows,
      subs,
      gifts,
      diamonds,
    },
    topChatters: [...users.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    topGifters: [...gifters.values()].sort((a, b) => b.diamonds - a.diamonds).slice(0, 5),
    questions,
    words: [...words.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

export function summaryPrompt(summary, sampleLines) {
  return [
    `Resumen del chat de los últimos ${summary.windowMinutes} minutos:`,
    JSON.stringify(summary.totals),
    `Usuarios que más hablan: ${summary.topChatters.map((u) => `${u.name} (${u.count})`).join(", ") || "nadie"}`,
    `Preguntas detectadas: ${summary.questions.map((q) => q.text).join(" | ") || "ninguna"}`,
    `Mensajes de ejemplo: ${sampleLines.join(" | ") || "sin mensajes"}`,
    "Dime en 4-6 líneas qué está pasando en el chat, qué preguntas conviene responder y una idea para dinamizar el directo. Sin inventar datos.",
  ].join("\n");
}
