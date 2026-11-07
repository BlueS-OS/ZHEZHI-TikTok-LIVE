import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const VIDEO_KINDS = new Set(["follow", "gift", "like"]);
export const MAX_ALERT_VIDEO_BYTES = 30 * 1024 * 1024;

export function videoExtension(bytes) {
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp" &&
    /^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(bytes.toString("ascii", 8, 12))) return "mp4";
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    bytes.subarray(0, 4096).includes(Buffer.from("webm"))) return "webm";
  throw new Error("Elige un vídeo MP4 o WebM válido");
}

export class AlertVideoStore {
  constructor(dir) { this.dir = dir; }

  file(kind) {
    if (!VIDEO_KINDS.has(kind)) throw new Error("Tipo de alerta no válido");
    for (const ext of ["mp4", "webm"]) {
      const filePath = path.join(this.dir, `${kind}.${ext}`);
      if (fs.existsSync(filePath)) return { filePath, ext };
    }
    return null;
  }

  urls() {
    return Object.fromEntries([...VIDEO_KINDS].map((kind) => {
      const file = this.file(kind);
      return [kind, file ? `/alert-video/${kind}.${file.ext}` : null];
    }));
  }

  async save(kind, bytes) {
    if (!VIDEO_KINDS.has(kind)) throw new Error("Tipo de alerta no válido");
    if (bytes.length < 128 || bytes.length > MAX_ALERT_VIDEO_BYTES) throw new Error("El vídeo debe ocupar entre 128 bytes y 30 MB");
    const ext = videoExtension(bytes);
    await fsp.mkdir(this.dir, { recursive: true });
    const target = path.join(this.dir, `${kind}.${ext}`);
    const tmp = `${target}.tmp`;
    try {
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, target);
    } catch (error) {
      await fsp.unlink(tmp).catch(() => {});
      throw error;
    }
    await fsp.unlink(path.join(this.dir, `${kind}.${ext === "mp4" ? "webm" : "mp4"}`)).catch(() => {});
    return this.urls();
  }

  async remove(kind) {
    if (!VIDEO_KINDS.has(kind)) throw new Error("Tipo de alerta no válido");
    for (const ext of ["mp4", "webm"]) await fsp.unlink(path.join(this.dir, `${kind}.${ext}`)).catch(() => {});
    return this.urls();
  }
}
