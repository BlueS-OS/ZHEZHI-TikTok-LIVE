import crypto from "node:crypto";

const USERS = [
  "luna_91",
  "ElTioPaco",
  "mari_gamer",
  "nocturno",
  "pixelada",
  "jorge_rt",
  "kira",
  "sandia_fria",
  "el_bosque",
  "nube",
];

const CHATS = [
  "hola!!",
  "buenas, ¿qué tal el directo?",
  "de dónde eres?",
  "juegas ranked hoy?",
  "jajaja qué bueno",
  "te sigo desde ayer, muy top",
  "!redes",
  "!horario",
  "cuánto llevas en directo?",
  "saluda a la luna porfa",
  "esto es una pregunta?",
  "💀💀💀",
  "GG",
  "pon música",
  "qué build usas?",
];

const GIFTS = [
  ["Rosa", 1],
  ["Tik Tok", 1],
  ["Helado", 5],
  ["Corazón", 10],
  ["León", 299],
  ["Universo", 34999],
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function person() {
  const username = pick(USERS);
  return {
    id: crypto.randomUUID(),
    name: username.replace(/_/g, " "),
    username,
    avatar: "",
  };
}

function event(kind, user, extra = {}) {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    kind,
    user,
    ...extra,
  };
}

export class Demo {
  constructor(onEvent, log = () => {}) {
    this.onEvent = onEvent;
    this.log = log;
    this.timer = null;
    this.active = false;
    this.viewers = 14;
    this.likes = 1200;
  }

  start(intervalMs = 3200) {
    if (this.active) return;
    this.active = true;
    this.log("Modo demo activado");
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.onEvent(event("viewers", undefined, { viewers: this.viewers }));
  }

  stop() {
    this.active = false;
    clearInterval(this.timer);
    this.timer = null;
    this.log("Modo demo desactivado");
  }

  emitKind(kind, options = {}) {
    const user = person();
    switch (kind) {
      case "gift": {
        const tier = options?.tier === "large" ? "large" : options?.tier === "small" ? "small" : "any";
        const pool = tier === "large" ? GIFTS.slice(-2) : tier === "small" ? GIFTS.slice(0, 3) : GIFTS;
        const [name, unit] = pick(pool);
        const count = tier === "large" ? 1 : Math.random() > 0.75 ? 3 : 1;
        const diamonds = unit * count;
        this.onEvent(
          event("gift", user, {
            text: name,
            gift: { name, count, diamonds, image: "" },
            diamonds,
            count,
          }),
        );
        break;
      }
      case "follow":
        this.onEvent(event("follow", user));
        break;
      case "subscribe":
        this.onEvent(event("subscribe", user, { months: 1 }));
        break;
      case "share":
        this.onEvent(event("share", user));
        break;
      case "join":
        this.onEvent(event("join", user));
        break;
      case "like":
        this.likes += 25;
        this.onEvent(event("like", user, { total: this.likes, count: 25 }));
        break;
      case "viewers":
        this.onEvent(event("viewers", undefined, { viewers: this.viewers }));
        break;
      case "question":
        this.onEvent(event("question", user, { text: "¿Cuál es tu juego favorito?" }));
        break;
      case "chat":
      default:
        this.onEvent(event("chat", user, { text: pick(CHATS) }));
        break;
    }
  }

  tick() {
    const roll = Math.random();
    if (roll < 0.66) this.emitKind("chat");
    else if (roll < 0.75) this.emitKind("follow");
    else if (roll < 0.82) this.emitKind("gift");
    else if (roll < 0.87) this.emitKind("share");
    else if (roll < 0.91) this.emitKind("like");
    else if (roll < 0.94) this.emitKind("join");
    else if (roll < 0.97) this.emitKind("question");
    else this.emitKind("subscribe");
    this.viewers = Math.max(3, this.viewers + Math.floor(Math.random() * 7) - 3);
    this.onEvent(event("viewers", undefined, { viewers: this.viewers }));
  }
}
