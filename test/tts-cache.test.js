import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VoiceEngine } from "../src/tts.js";

async function fileAt(dir, name, minutesAgo) {
  const target = path.join(dir, name);
  await writeFile(target, Buffer.alloc(512));
  const date = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(target, date, date);
  return target;
}

test("limpia audios antiguos sin tocar sonidos recientes ni archivos ajenos", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhezhi-tts-"));
  const voice = new VoiceEngine({ dir });
  t.after(async () => { voice.stop(); await rm(dir, { recursive: true, force: true }); });
  await fileAt(dir, `voz-${"a".repeat(20)}.mp3`, 40);
  await fileAt(dir, `voz-${"b".repeat(20)}-respaldo.wav`, 40);
  await fileAt(dir, `voz-${"c".repeat(20)}.wav.tmp`, 40);
  await fileAt(dir, `voz-${"d".repeat(20)}.wav`, 2);
  await fileAt(dir, "mi-grabacion.wav", 120);

  await voice.init();
  assert.deepEqual((await readdir(dir)).sort(), ["mi-grabacion.wav", `voz-${"d".repeat(20)}.wav`]);
});

test("limita el número de audios sin borrar los que podrían seguir sonando", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhezhi-tts-"));
  const voice = new VoiceEngine({ dir });
  t.after(async () => { voice.stop(); await rm(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 82; i += 1) {
    await fileAt(dir, `voz-${i.toString(16).padStart(20, "0")}.mp3`, 6);
  }
  const recent = `voz-${"f".repeat(20)}.mp3`;
  await fileAt(dir, recent, 1);
  await voice.cleanup();
  const files = await readdir(dir);
  assert.equal(files.length, 80);
  assert.ok(files.includes(recent));
});

test("renueva la vida de un audio de voz reutilizado", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhezhi-tts-"));
  const voice = new VoiceEngine({ dir });
  t.after(async () => { voice.stop(); await rm(dir, { recursive: true, force: true }); });
  const key = crypto.createHash("sha1")
    .update(JSON.stringify(["edge", undefined, undefined, undefined, undefined, undefined, undefined, undefined, "hola"]))
    .digest("hex").slice(0, 20);
  const filePath = await fileAt(dir, `voz-${key}.mp3`, 29);
  const result = await voice.synthesize("hola", { provider: "edge" });
  assert.equal(result.filePath, filePath);
  assert.ok(Date.now() - (await stat(filePath)).mtimeMs < 5000);
});
