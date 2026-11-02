import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { voiceStudioSpeech } from "./voicestudio.js";

const FALLBACK_EDGE_VOICES = [
  ["es-ES-ElviraNeural", "Elvira", "es-ES", "Female"],
  ["es-ES-AlvaroNeural", "Álvaro", "es-ES", "Male"],
  ["es-MX-DaliaNeural", "Dalia", "es-MX", "Female"],
  ["es-MX-JorgeNeural", "Jorge", "es-MX", "Male"],
  ["es-AR-ElenaNeural", "Elena", "es-AR", "Female"],
  ["es-AR-TomasNeural", "Tomás", "es-AR", "Male"],
  ["es-CO-SalomeNeural", "Salomé", "es-CO", "Female"],
  ["es-CO-GonzaloNeural", "Gonzalo", "es-CO", "Male"],
  ["es-US-PalomaNeural", "Paloma", "es-US", "Female"],
  ["es-US-AlonsoNeural", "Alonso", "es-US", "Male"],
];

const SAPI_SCRIPT = path.join(import.meta.dirname, "sapi.ps1");

export function cleanForSpeech(value, maxChars = 180) {
  let text = String(value ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1).trim()}…`;
  return text;
}

function runPowerShell(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SAPI_SCRIPT, ...args],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("La voz de Windows tardó demasiado"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PowerShell terminó con código ${code}`));
    });
  });
}

function hashKey(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 20);
}

export class VoiceEngine {
  constructor({ dir, log = () => {} }) {
    this.dir = dir;
    this.log = log;
    this.queue = [];
    this.busy = false;
    this.voices = null;
    this.voicesAt = 0;
    this.lastStart = 0;
    this.stopped = false;
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    const now = Date.now();
    try {
      const files = await fsp.readdir(this.dir);
      await Promise.all(
        files.map(async (name) => {
          const full = path.join(this.dir, name);
          const stat = await fsp.stat(full).catch(() => null);
          if (stat && now - stat.mtimeMs > 12 * 3600_000) {
            await fsp.unlink(full).catch(() => {});
          }
        }),
      );
    } catch {
      // La caché es prescindible.
    }
  }

  stop() {
    this.stopped = true;
    this.queue = [];
  }

  /** Devuelve true si entra en la cola. */
  enqueue(text, options, onReady, onError, meta = {}) {
    if (this.stopped) return false;
    const job = { text, options, onReady, onError, kind: meta.kind || "chat", createdAt: Date.now() };
    // No leer un chat antiguo si han entrado comentarios nuevos mientras se generaba audio.
    if (job.kind === "chat") {
      this.queue = this.queue.filter((queued) => queued.kind !== "chat");
      this.queue.push(job);
    } else {
      const firstChat = this.queue.findIndex((queued) => queued.kind === "chat");
      this.queue.splice(firstChat < 0 ? this.queue.length : firstChat, 0, job);
    }
    const maxQueued = Math.max(1, Number(meta.maxQueue) || 6);
    while (this.queue.length > maxQueued) {
      const chatIndex = this.queue.findIndex((queued) => queued.kind === "chat");
      this.queue.splice(chatIndex < 0 ? 0 : chatIndex, 1);
    }
    this.#drain();
    return true;
  }

  get pending() {
    return this.queue.length + (this.busy ? 1 : 0);
  }

  async #drain() {
    if (this.busy || this.stopped) return;
    const job = this.queue.shift();
    if (!job) return;
    if (job.kind === "chat" && Date.now() - job.createdAt > 12000) {
      this.#drain();
      return;
    }
    this.busy = true;
    try {
      const gap = Number(job.options.minIntervalMs) || 0;
      const wait = this.lastStart + gap - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastStart = Date.now();
      const result = await this.synthesize(job.text, job.options);
      if (job.kind !== "chat" || Date.now() - job.createdAt <= 20000) {
        job.onReady?.(result);
      }
    } catch (error) {
      this.log(`voz: ${error.message}`);
      job.onError?.(error);
    } finally {
      this.busy = false;
      if (!this.stopped) this.#drain();
    }
  }

  async synthesize(text, options = {}) {
    const spoken = cleanForSpeech(text, Number(options.maxChars) || 180);
    if (!spoken) throw new Error("No hay texto que leer");
    const provider = ["sapi", "voicestudio"].includes(options.provider) ? options.provider : "edge";
    const key = hashKey(
      JSON.stringify([
        provider,
        options.voice,
        options.sapiVoice,
        options.voiceStudioPort,
        options.voiceStudioVoice,
        options.voiceStudioModel,
        options.rate,
        options.volume,
        spoken,
      ]),
    );
    const ext = provider === "edge" ? "mp3" : "wav";
    const fileName = `voz-${key}.${ext}`;
    const filePath = path.join(this.dir, fileName);
    if (fs.existsSync(filePath)) {
      return { fileName, filePath, provider, text: spoken };
    }

    try {
      if (provider === "sapi") await this.#sapi(spoken, filePath, options);
      else if (provider === "voicestudio") await this.#voiceStudio(spoken, filePath, options);
      else await this.#edge(spoken, filePath, options);
    } catch (error) {
      if (provider === "sapi") throw error;
       // El directo sigue sonando aunque el motor opcional no esté disponible.
       this.log(`voz: ${provider === "edge" ? "Edge" : "VoiceStudio"} falló (${error.message}); uso la voz de Windows`);
       const fallbackName = `voz-${key}-respaldo.wav`;
       const fallbackPath = path.join(this.dir, fallbackName);
       await this.#sapi(spoken, fallbackPath, options);
       const fallbackStat = await fsp.stat(fallbackPath).catch(() => null);
       if (!fallbackStat || fallbackStat.size < 500) {
         await fsp.unlink(fallbackPath).catch(() => {});
         throw new Error("La voz de Windows salió vacía");
       }
       this.#trimCache().catch(() => {});
       return {
         fileName: fallbackName,
         filePath: fallbackPath,
         provider: "sapi",
         fallbackFrom: provider,
         fallbackReason: error.message,
         text: spoken,
       };
    }

    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || stat.size < 500) {
      await fsp.unlink(filePath).catch(() => {});
      throw new Error("La voz salió vacía");
    }
    this.#trimCache().catch(() => {});
    return { fileName, filePath, provider, text: spoken };
  }

  async #edge(text, filePath, options) {
    const voice = options.voice || "es-ES-ElviraNeural";
    const rate = Math.round(Number(options.rate) || 0);
    const volume = Math.min(100, Math.max(0, Math.round(Number(options.volume ?? 100))));
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 12000, synthesisTimeoutMs: 30000 });
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text, {
        rate: `${rate >= 0 ? "+" : ""}${rate}%`,
        volume,
      });
      const chunks = [];
      for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
      if (!chunks.length) throw new Error("sin audio");
      const tmp = `${filePath}.tmp`;
      await fsp.writeFile(tmp, Buffer.concat(chunks));
      await fsp.rename(tmp, filePath);
    } finally {
      tts.close();
    }
  }

  async #voiceStudio(text, filePath, options) {
    const audio = await voiceStudioSpeech(text, {
      port: options.voiceStudioPort,
      model: options.voiceStudioModel,
      voice: options.voiceStudioVoice,
      rate: options.rate,
    });
    const tmp = `${filePath}.tmp`;
    await fsp.writeFile(tmp, audio);
    await fsp.rename(tmp, filePath);
  }

  async #sapi(text, filePath, options) {
    const textFile = `${filePath}.txt`;
    await fsp.writeFile(textFile, text, "utf8");
    const rate = Math.max(-10, Math.min(10, Math.round((Number(options.rate) || 0) / 10)));
    const volume = Math.min(100, Math.max(0, Math.round(Number(options.volume ?? 100))));
    try {
      await runPowerShell([
        "-TextFile",
        textFile,
        "-OutFile",
        filePath,
        "-Voice",
        options.sapiVoice || "Microsoft Helena Desktop",
        "-Rate",
        String(rate),
        "-Volume",
        String(volume),
      ]);
    } finally {
      await fsp.unlink(textFile).catch(() => {});
    }
  }

  async #trimCache() {
    const files = await fsp.readdir(this.dir);
    if (files.length <= 250) return;
    const stats = await Promise.all(
      files.map(async (name) => {
        const full = path.join(this.dir, name);
        const stat = await fsp.stat(full).catch(() => null);
        return stat ? { full, mtimeMs: stat.mtimeMs } : null;
      }),
    );
    const sorted = stats.filter(Boolean).sort((a, b) => a.mtimeMs - b.mtimeMs);
    await Promise.all(sorted.slice(0, files.length - 200).map((f) => fsp.unlink(f.full).catch(() => {})));
  }

  async listVoices() {
    if (this.voices && Date.now() - this.voicesAt < 3600_000) return this.voices;
    const edgeMap = new Map(
      FALLBACK_EDGE_VOICES.map(([id, name, locale, gender]) => [
        id,
        { id, name, locale, gender },
      ]),
    );
    try {
      const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000 });
      const voices = await tts.getVoices();
      tts.close();
      for (const voice of voices) {
        if (!String(voice.Locale || "").toLowerCase().startsWith("es")) continue;
        edgeMap.set(voice.ShortName, {
          id: voice.ShortName,
          name: voice.FriendlyName?.replace(/\s*-\s*Spanish.*$/i, "") || voice.ShortName,
          locale: voice.Locale,
          gender: voice.Gender,
        });
      }
    } catch (error) {
      this.log(`voz: no pude listar las voces de Edge (${error.message})`);
    }
    let sapi = [];
    try {
      const out = await runPowerShell(["-List"], 10000);
      sapi = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch {
      sapi = [];
    }
    this.voices = {
      edge: [...edgeMap.values()].sort((a, b) => a.locale.localeCompare(b.locale)),
      sapi,
    };
    this.voicesAt = Date.now();
    return this.voices;
  }
}
