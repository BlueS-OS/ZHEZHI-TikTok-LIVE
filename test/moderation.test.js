import test from "node:test";
import assert from "node:assert/strict";
import { createModerationState, evaluateMessage } from "../src/moderation.js";

const cfg = {
  enabled: true,
  bannedWords: ["estafa", "puta"],
  blockLinks: true,
  maxCapsRatio: 0.75,
  maxEmojis: 8,
  blockRepeats: true,
  repeatWindowSec: 30,
  maxMentions: 4,
};

test("deja pasar un mensaje normal", () => {
  const state = createModerationState();
  const result = evaluateMessage("hola, ¿qué tal el directo?", "u1", cfg, state);
  assert.equal(result.hidden, false);
});

test("oculta palabras prohibidas sin importar acentos ni mayúsculas", () => {
  const state = createModerationState();
  const result = evaluateMessage("ESTO ES UNA ESTÁFA", "u2", cfg, state);
  assert.equal(result.hidden, true);
  assert.equal(result.reasons[0].code, "banned");
});

test("oculta enlaces", () => {
  const state = createModerationState();
  assert.equal(evaluateMessage("mira https://ejemplo.com", "u3", cfg, state).hidden, true);
  assert.equal(evaluateMessage("mi web es pagina.com", "u3", cfg, state).hidden, true);
});

test("oculta mayúsculas sostenidas", () => {
  const state = createModerationState();
  assert.equal(evaluateMessage("ESTO ES UNA PRUEBA MUY LARGA", "u4", cfg, state).hidden, true);
});

test("oculta el mismo mensaje repetido dentro de la ventana", () => {
  const state = createModerationState();
  const first = evaluateMessage("gg", "u5", cfg, state, 1000);
  const second = evaluateMessage("gg", "u5", cfg, state, 2000);
  assert.equal(first.hidden, false);
  assert.equal(second.hidden, true);
  assert.ok(second.reasons.some((reason) => reason.code === "repeat"));
});

test("no oculta la repetición de otro usuario", () => {
  const state = createModerationState();
  evaluateMessage("gg", "u6", cfg, state, 1000);
  assert.equal(evaluateMessage("gg", "u7", cfg, state, 1500).hidden, false);
});

test("permite desactivar la moderación", () => {
  const state = createModerationState();
  const result = evaluateMessage("ESTAFA https://x.com", "u8", { ...cfg, enabled: false }, state);
  assert.equal(result.hidden, false);
});
