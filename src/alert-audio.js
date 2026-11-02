import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const AUDIO_KINDS = new Set(["follow", "gift", "like"]);
export const MAX_ALERT_AUDIO_BYTES = 12 * 1024 * 1024;

export function audioExtension(bytes) {
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  throw new Error("Elige un audio MP3 o WAV válido");
}

export class AlertAudioStore {
  constructor(dir) {
    this.dir = dir;
  }

  file(kind) {
    if (!AUDIO_KINDS.has(kind)) throw new Error("Tipo de alerta no válido");
    for (const ext of ["mp3", "wav"]) {
      const filePath = path.join(this.dir, `${kind}.${ext}`);
      if (fs.existsSync(filePath)) return { filePath, ext };
    }
    return null;
  }

  urls() {
    return Object.fromEntries([...AUDIO_KINDS].map((kind) => {
      const file = this.file(kind);
      return [kind, file ? `/alert-audio/${kind}.${file.ext}` : null];
    }));
  }

  async save(kind, bytes) {
    if (!AUDIO_KINDS.has(kind)) throw new Error("Tipo de alerta no válido");
    if (bytes.length < 128 || bytes.length > MAX_ALERT_AUDIO_BYTES) throw new Error("El audio debe ocupar entre 128 bytes y 12 MB");
    const ext = audioExtension(bytes);
    await fsp.mkdir(this.dir, { recursive: true });
    const target = path.join(this.dir, `${kind}.${ext}`);
    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, bytes);
    await fsp.rename(tmp, target);
    await fsp.unlink(path.join(this.dir, `${kind}.${ext === "mp3" ? "wav" : "mp3"}`)).catch(() => {});
    return this.urls();
  }

  async remove(kind) {
    if (!AUDIO_KINDS.has(kind)) throw new Error("Tipo de alerta no válido");
    for (const ext of ["mp3", "wav"]) await fsp.unlink(path.join(this.dir, `${kind}.${ext}`)).catch(() => {});
    return this.urls();
  }
}
