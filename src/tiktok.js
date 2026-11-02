import { EventEmitter } from "node:events";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
import { safeErrorDetails } from "./diagnostics.js";
import {
  normalizeChat,
  normalizeFollow,
  normalizeGift,
  normalizeJoin,
  normalizeLike,
  normalizeQuestion,
  normalizeShare,
  normalizeSubscribe,
  normalizeViewers,
} from "./normalize.js";

export function cleanUsername(value) {
  let name = String(value || "").trim();
  const url = name.match(/tiktok\.com\/@?([\w.-]+)/i);
  if (url) name = url[1];
  return name.replace(/^@+/, "").replace(/[/?#].*$/, "").trim();
}

export function buildConnectionOptions(cfg) {
  const options = {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    // El catálogo ampliado de regalos firma una petición adicional a gift/list/.
    // Si Euler Stream no entrega tokens, impedía conectar incluso para leer el chat.
    enableExtendedGiftInfo: false,
  };
  if (cfg.tiktok.signApiKey) options.signApiKey = cfg.tiktok.signApiKey;
  if (cfg.tiktok.sessionId && cfg.tiktok.ttTargetIdc) {
    options.session = {
      cookie: {
        type: "cookie",
        value: {
          sessionId: cfg.tiktok.sessionId,
          ttTargetIdc: cfg.tiktok.ttTargetIdc,
        },
      },
    };
    if (cfg.tiktok.authenticateWs) options.authenticateWs = true;
  }
  return options;
}

export function explainConnectionError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || error || "");
  const reason = String(error?.reason || "");
  const status = /Unexpected sign server status (\d{3})/.exec(message)?.[1];
  if (/\b(EACCES|EPERM)\b/i.test(message) || ["EACCES", "EPERM"].includes(error?.code)) {
    return "Zhezhi no puede acceder a Internet desde este proceso (acceso denegado). Ábrelo con 'Iniciar Zhezhi.bat' desde el Explorador de Windows; si continúa, revisa el firewall o antivirus.";
  }
  if (/\b(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET)\b/i.test(message)) {
    return "Zhezhi no pudo llegar al servicio de TikTok o de firma por la red. Comprueba Internet, DNS y que el firewall no bloquee node.exe.";
  }
  if (name.includes("UserOffline") || /\boffline\b/i.test(message)) {
    return "Ese usuario no está en directo ahora mismo.";
  }
  if (name.includes("InvalidUniqueId")) return "El usuario de TikTok no es válido.";
  if (reason === "Rate Limited" || status === "429" || /rate limit|too many connections|\b429\b/i.test(message)) {
    return "El servicio de firma limitó las conexiones (429). No pulses Conectar repetidamente: espera unos minutos antes de intentarlo de nuevo.";
  }
  if (status === "401" || status === "403" || reason === "Premium Feature") {
    return `El servicio de firma rechazó la conexión${status ? ` (${status})` : ""}. Es una restricción de la API usada por la integración; revisa sus condiciones o prueba más tarde. No compartas tu cookie de TikTok.`;
  }
  if (status && status !== "200") {
    return `El servicio de firma devolvió HTTP ${status}. Puede ser un fallo temporal o una restricción de la API; vuelve a intentarlo más tarde.`;
  }
  if (name === "SignatureMissingTokensError") {
    return "El servicio de firma devolvió una respuesta sin los tokens necesarios. No es un problema de acceso a Internet; la API no pudo firmar esta petición.";
  }
  if (name.includes("Sign") || /\bsign(?:ature)?\b/i.test(message)) {
    return "Zhezhi no pudo completar la firma de la conexión a TikTok. Puede ser la API de Euler Stream o la red; sin un código HTTP no se puede saber cuál. No hace falta una clave para intentar leer el chat, pero el servicio gratuito puede imponer límites.";
  }
  if (message.includes("Failed to retrieve Room ID from all sources")) {
    const causes = error?.config?.requestErrs || [];
    const summary = causes.map((cause) => {
      const detail = String(cause?.message || "");
      const code = cause?.response?.statusCode || cause?.code;
      if (/rate limit|\b429\b/i.test(detail) || code === 429) return "límite de peticiones";
      if (/permission|\b40[123]\b/i.test(detail) || [401, 402, 403].includes(code)) return "acceso restringido";
      if (/\b404\b|not found/i.test(detail) || code === 404) return "sala no encontrada";
      if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONN|network|timeout/i.test(detail) || /^(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONN)/.test(String(code))) return "problema de red";
      return "sin datos de sala";
    });
    const reason = [...new Set(summary)].join(", ");
    return `No pude encontrar el Room ID del directo${reason ? ` (${reason})` : ""}. Comprueba que @usuario está en vivo y que https://www.tiktok.com/@usuario/live abre el directo en una ventana privada. Si sí abre, reintenta en un minuto; TikTok puede bloquear la consulta. Si conoces el Room ID numérico, escríbelo en Conexión.`;
  }
  return message || "No se pudo conectar al directo.";
}

export class TikTokManager extends EventEmitter {
  constructor(log = () => {}) {
    super();
    this.log = log;
    this.connection = null;
    this.manualStop = true;
    this.retryTimer = null;
    this.retries = 0;
    this.lastConfig = null;
    this.seen = new Set();
    this.status = { state: "idle", username: "", roomId: "", error: "", diagnostic: null, since: 0, attempt: 0 };
  }

  snapshot() {
    return { ...this.status };
  }

  updateConfig(cfg) {
    this.lastConfig = cfg;
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.snapshot());
  }

  #remember(id) {
    if (!id) return true;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 1500) {
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }
    return true;
  }

  #accept(event) {
    if (!event || !event.kind) return;
    if (!this.#remember(event.id)) return;
    this.emit("live", event);
  }

  async connect(cfg, { retry = false } = {}) {
    this.lastConfig = cfg;
    const username = cleanUsername(cfg?.tiktok?.username);
    if (!username) throw new Error("Escribe el usuario de TikTok (sin @)");
    const roomId = String(cfg?.tiktok?.roomId || "").trim();
    if (roomId && !/^\d{10,30}$/.test(roomId)) {
      throw new Error("El Room ID debe ser un número de 10 a 30 dígitos; déjalo vacío para buscarlo automáticamente.");
    }
    if (this.connection && (this.connection.isConnected || this.connection.isConnecting)) {
      throw new Error("Ya hay una conexión abierta");
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.manualStop = false;
    if (!retry) this.retries = 0;

    const options = buildConnectionOptions(cfg);

    this.#setStatus({
      state: this.retries > 0 ? "reconnecting" : "connecting",
      username,
      error: "",
      diagnostic: null,
      attempt: this.retries,
    });

    const connection = new TikTokLiveConnection(username, options);
    this.connection = connection;

    connection.on("connected", (state) => {
      this.retries = 0;
      this.#setStatus({
        state: "connected",
        roomId: String(state?.roomId || connection.roomId || ""),
        error: "",
        diagnostic: null,
        since: Date.now(),
        attempt: 0,
      });
      this.log(`TikTok: conectado a @${username} (sala ${this.status.roomId || "?"})`);
      this.emit("system", { text: `Conectado a @${username}` });
    });

    connection.on("disconnected", ({ code, reason } = {}) => {
      if (this.manualStop) {
        this.#setStatus({ state: "idle", roomId: "", error: "" });
        return;
      }
      const detail = reason || (code ? `código ${code}` : "sin motivo");
      this.log(`TikTok: conexión cerrada (${detail})`);
      this.#scheduleRetry(`Se cortó la conexión (${detail})`);
    });

    connection.on("streamEnd", () => {
      this.manualStop = true;
      this.#setStatus({ state: "ended", error: "" });
      this.emit("system", { text: "El directo ha terminado" });
    });

    connection.on("error", (payload) => {
      const message = explainConnectionError(payload?.exception || payload?.info || "Error de TikTok");
      if (this.status.state === "connected") {
        this.log(`TikTok: ${message}`);
        this.emit("warning", { text: message });
      }
    });

    connection.on(WebcastEvent.CHAT, (data) => this.#accept(normalizeChat(data)));
    connection.on(WebcastEvent.GIFT, (data) => this.#accept(normalizeGift(data)));
    connection.on(WebcastEvent.FOLLOW, (data) => this.#accept(normalizeFollow(data)));
    connection.on(WebcastEvent.SHARE, (data) => this.#accept(normalizeShare(data)));
    connection.on(WebcastEvent.SUB_NOTIFY, (data) => this.#accept(normalizeSubscribe(data)));
    connection.on(WebcastEvent.MEMBER, (data) => this.#accept(normalizeJoin(data)));
    connection.on(WebcastEvent.LIKE, (data) => this.#accept(normalizeLike(data)));
    connection.on(WebcastEvent.ROOM_USER, (data) => this.#accept(normalizeViewers(data)));
    connection.on(WebcastEvent.QUESTION_NEW, (data) => this.#accept(normalizeQuestion(data)));

    try {
      const state = await connection.connect(roomId || undefined);
      if (state?.roomId && this.status.state !== "connected") {
        this.#setStatus({ state: "connected", roomId: String(state.roomId), since: Date.now() });
      }
    } catch (error) {
      this.connection = null;
      const friendly = this.#friendlyError(error);
      const diagnostic = safeErrorDetails(error);
      if (retry && !this.manualStop) {
        this.#scheduleRetry(friendly, diagnostic);
        return;
      }
      this.manualStop = true;
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.#setStatus({ state: "error", error: friendly, diagnostic, roomId: "" });
      this.log(`TikTok: ${friendly}`);
      throw new Error(friendly);
    }
  }

  #friendlyError(error) {
    return explainConnectionError(error);
  }

  #scheduleRetry(reason, diagnostic = null) {
    if (this.manualStop) return;
    if (this.retries >= 5) {
      this.#setStatus({ state: "error", error: `${reason}. Me rindo tras 5 intentos.` });
      return;
    }
    this.retries += 1;
    const delay = Math.min(30_000, 5000 * this.retries);
    this.#setStatus({
      state: "reconnecting",
      error: reason,
      diagnostic,
      attempt: this.retries,
      nextRetryAt: Date.now() + delay,
    });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.connection = null;
      this.connect(this.lastConfig, { retry: true }).catch(() => {});
    }, delay);
  }

  async disconnect() {
    this.manualStop = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const connection = this.connection;
    this.connection = null;
    if (connection) {
      try {
        await connection.disconnect();
      } catch {
        // Ya estaba cerrada.
      }
    }
    this.#setStatus({ state: "idle", roomId: "", error: "", since: 0 });
  }

  async sendMessage(text) {
    const cfg = this.lastConfig;
    const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 150);
    if (!clean) throw new Error("La respuesta está vacía");
    if (!this.connection?.isConnected) throw new Error("No hay conexión con el directo");
    if (!cfg?.tiktok?.signApiKey) {
      throw new Error("Para escribir en el chat hace falta una clave de Euler Stream");
    }
    if (!cfg?.tiktok?.sessionId) {
      throw new Error("Para escribir en el chat hace falta la cookie sessionid de TikTok");
    }
    await this.connection.sendMessage(clean);
    return clean;
  }
}
