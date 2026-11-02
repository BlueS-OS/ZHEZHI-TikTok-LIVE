import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AlertAudioStore, audioExtension, MAX_ALERT_AUDIO_BYTES } from "../src/alert-audio.js";
import { defaultConfig, normalizeConfig } from "../src/config.js";

const wav = Buffer.alloc(128);
wav.write("RIFF", 0);
wav.write("WAVE", 8);
const mp3 = Buffer.alloc(128);
mp3.write("ID3", 0);

test("los audios personalizados están apagados por defecto y no cambian la voz", () => {
  const config = defaultConfig();
  assert.equal(config.customAudio.enabled, false);
  assert.equal(config.tts.readAlerts, true);
  const saved = normalizeConfig({ customAudio: { enabled: true, follow: false, gift: true, like: false, volume: 32 } });
  assert.deepEqual(saved.customAudio, { enabled: true, follow: false, gift: true, like: false, volume: 32 });
  assert.equal(normalizeConfig({}).alerts.like, true);
});

test("detecta WAV y MP3 por su contenido, no por el nombre", () => {
  assert.equal(audioExtension(wav), "wav");
  assert.equal(audioExtension(mp3), "mp3");
  assert.equal(audioExtension(Buffer.from([0xff, 0xfb, 0x90, 0x64])), "mp3");
  assert.throws(() => audioExtension(Buffer.alloc(128)), /MP3 o WAV/);
});

test("guarda archivos independientes, reemplaza formatos y los elimina", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhezhi-alerts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new AlertAudioStore(dir);
  assert.deepEqual(store.urls(), { follow: null, gift: null, like: null });
  await store.save("follow", wav);
  await store.save("gift", mp3);
  await store.save("like", wav);
  assert.deepEqual(store.urls(), { follow: "/alert-audio/follow.wav", gift: "/alert-audio/gift.mp3", like: "/alert-audio/like.wav" });
  assert.deepEqual(await readFile(path.join(dir, "follow.wav")), wav);
  await store.save("follow", mp3);
  assert.deepEqual(store.urls(), { follow: "/alert-audio/follow.mp3", gift: "/alert-audio/gift.mp3", like: "/alert-audio/like.wav" });
  await store.remove("gift");
  assert.deepEqual(store.urls(), { follow: "/alert-audio/follow.mp3", gift: null, like: "/alert-audio/like.wav" });
});

test("rechaza archivos inválidos o demasiado grandes y tipos de evento desconocidos", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhezhi-alerts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new AlertAudioStore(dir);
  await assert.rejects(store.save("follow", Buffer.alloc(128)), /MP3 o WAV/);
  await assert.rejects(store.save("gift", Buffer.alloc(MAX_ALERT_AUDIO_BYTES + 1)), /12 MB/);
  await assert.rejects(store.save("subscribe", wav), /no válido/);
  await assert.rejects(store.remove("subscribe"), /no válido/);
  assert.deepEqual(store.urls(), { follow: null, gift: null, like: null });
});
