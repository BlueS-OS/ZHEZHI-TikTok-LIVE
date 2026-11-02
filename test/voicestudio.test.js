import test from "node:test";
import assert from "node:assert/strict";
import { voiceStudioBase, voiceStudioNetworkError, voiceStudioSpeech, voiceStudioVoices } from "../src/voicestudio.js";
import { normalizeConfig } from "../src/config.js";

test("el proveedor local conserva la selección y solo apunta a loopback", () => {
  const cfg = normalizeConfig({ tts: { provider: "voicestudio", voiceStudioPort: 3900, voiceStudioVoice: "perfil-uno" } });
  assert.equal(cfg.tts.provider, "voicestudio");
  assert.equal(cfg.tts.voiceStudioVoice, "perfil-uno");
  assert.equal(voiceStudioBase(cfg.tts.voiceStudioPort), "http://127.0.0.1:3900");
  assert.throws(() => voiceStudioBase("http://otro-servidor"), /Puerto/);
});

test("detecta voces a través de la API de VoiceStudio", async () => {
  const requested = [];
  const voices = await voiceStudioVoices(3900, async (url) => {
    requested.push(url);
    return url.endsWith("/health")
      ? { ok: true }
      : { ok: true, json: async () => ({ voices: [{ voice_id: "abc", name: "Mi voz", type: "profile" }] }) };
  });
  assert.deepEqual(requested, ["http://127.0.0.1:3900/health", "http://127.0.0.1:3900/v1/audio/voices"]);
  assert.deepEqual(voices, [{ id: "abc", name: "Mi voz", type: "profile" }]);
});

test("genera WAV local con el perfil elegido", async () => {
  const wav = Buffer.alloc(600);
  wav.write("RIFF", 0, "ascii");
  wav.write("WAVE", 8, "ascii");
  let request;
  const audio = await voiceStudioSpeech("Hola", { port: 3900, model: "tts-1", voice: "abc", rate: 20 }, async (url, options) => {
    request = { url, options };
    return { ok: true, arrayBuffer: async () => wav };
  });
  assert.equal(request.url, "http://127.0.0.1:3900/v1/audio/speech");
  assert.deepEqual(JSON.parse(request.options.body), { model: "tts-1", input: "Hola", voice: "abc", response_format: "wav", speed: 1.2 });
  assert.deepEqual(audio, wav);
});

test("rechaza una respuesta que no sea audio WAV", async () => {
  await assert.rejects(
    voiceStudioSpeech("Hola", { port: 3900 }, async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(600) })),
    /WAV válido/,
  );
});

test("explica cuándo VoiceStudio está cerrado", () => {
  const error = new TypeError("fetch failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) });
  assert.match(voiceStudioNetworkError(error, 3900).message, /VoiceStudio no está abierto/);
});
