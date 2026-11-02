import test from "node:test";
import assert from "node:assert/strict";
import { applySettings, defaultConfig, normalizeConfig, publicConfig } from "../src/config.js";

test("normaliza valores fuera de rango", () => {
  const cfg = normalizeConfig({
    port: 12,
    tts: { rate: 999, volume: -20, maxQueue: 999 },
    overlay: { chatMax: 0 },
  });
  assert.equal(cfg.port, 1024);
  assert.equal(cfg.tts.rate, 100);
  assert.equal(cfg.tts.volume, 0);
  assert.equal(cfg.tts.maxQueue, 50);
  assert.equal(cfg.overlay.chatMax, 1);
});

test("elimina reglas incompletas", () => {
  const cfg = normalizeConfig({
    reply: { rules: [{ pattern: "", response: "x" }, { pattern: "!ok", response: "vale" }] },
  });
  assert.equal(cfg.reply.rules.length, 1);
  assert.equal(cfg.reply.rules[0].pattern, "!ok");
});

test("no borra secretos cuando el campo llega vacío", () => {
  const base = defaultConfig();
  base.tiktok.signApiKey = "clave";
  base.tiktok.sessionId = "sesion";
  const next = applySettings(base, { tiktok: { username: "nuevo", signApiKey: "" } });
  assert.equal(next.tiktok.signApiKey, "clave");
  assert.equal(next.tiktok.username, "nuevo");
});

test("borra secretos con la bandera explícita", () => {
  const base = defaultConfig();
  base.ai.apiKey = "sk-test";
  const next = applySettings(base, { ai: { clearApiKey: true } });
  assert.equal(next.ai.apiKey, "");
});

test("la configuración pública no expone secretos", () => {
  const base = defaultConfig();
  base.tiktok.signApiKey = "clave";
  base.tiktok.sessionId = "sesion";
  base.ai.apiKey = "sk";
  const pub = publicConfig(base);
  assert.equal(pub.tiktok.signApiKey, "");
  assert.equal(pub.tiktok.sessionId, "");
  assert.equal(pub.ai.apiKey, "");
  assert.equal(pub.tiktok.hasSignApiKey, true);
  assert.equal(pub.ai.hasApiKey, true);
});

test("quita la arroba del usuario", () => {
  const cfg = normalizeConfig({ tiktok: { username: "@MiCanal" } });
  assert.equal(cfg.tiktok.username, "MiCanal");
});
