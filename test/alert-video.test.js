import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AlertVideoStore, videoExtension, MAX_ALERT_VIDEO_BYTES } from "../src/alert-video.js";
import { defaultConfig, normalizeConfig } from "../src/config.js";

const mp4 = Buffer.alloc(128);
mp4.writeUInt32BE(24, 0);
mp4.write("ftyp", 4);
mp4.write("isom", 8);
const webm = Buffer.alloc(128);
Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(webm);
webm.write("webm", 16);

test("el vídeo es opcional y la normalización rechaza chroma inválido", () => {
  assert.equal(defaultConfig().customVideo.enabled, false);
  assert.equal(defaultConfig().customVideo.sound, true);
  assert.equal(defaultConfig().tts.readAlerts, true);
  assert.equal(normalizeConfig({ customVideo: { enabled: true, chroma: "blue" } }).customVideo.chroma, "blue");
  assert.equal(normalizeConfig({ customVideo: { sound: false } }).customVideo.sound, false);
  assert.equal(normalizeConfig({ customVideo: { chroma: "red" } }).customVideo.chroma, "none");
});

test("valida contenido MP4 y WebM, no la extensión indicada por el usuario", () => {
  assert.equal(videoExtension(mp4), "mp4");
  assert.equal(videoExtension(webm), "webm");
  assert.throws(() => videoExtension(Buffer.alloc(128)), /MP4 o WebM/);
});

test("los vídeos se guardan por evento y no afectan archivos de audio", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhezhi-video-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new AlertVideoStore(dir);
  assert.deepEqual(store.urls(), { follow: null, gift: null, like: null });
  await store.save("follow", mp4);
  await store.save("gift", webm);
  await store.save("follow", webm);
  assert.deepEqual(store.urls(), { follow: "/alert-video/follow.webm", gift: "/alert-video/gift.webm", like: null });
  assert.deepEqual(await readFile(path.join(dir, "follow.webm")), webm);
  await store.remove("gift");
  assert.equal(store.urls().gift, null);
  await assert.rejects(store.save("like", Buffer.alloc(128)), /MP4 o WebM/);
  await assert.rejects(store.save("like", Buffer.alloc(MAX_ALERT_VIDEO_BYTES + 1)), /30 MB/);
  await assert.rejects(store.save("chat", mp4), /no válido/);
});
