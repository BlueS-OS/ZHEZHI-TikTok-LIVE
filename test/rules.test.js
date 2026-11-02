import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReply,
  createReplyState,
  matchRule,
  pickRule,
  registerReply,
} from "../src/rules.js";

const rules = [
  { id: "redes", enabled: true, match: "command", pattern: "!redes", response: "mis redes", cooldownSec: 30 },
  { id: "hola", enabled: true, match: "contains", pattern: "buenas", response: "hola!", cooldownSec: 0 },
  { id: "apagada", enabled: false, match: "exact", pattern: "test", response: "no", cooldownSec: 0 },
  { id: "regex", enabled: true, match: "regex", pattern: "^precio\\s+\\d+", response: "te lo paso", cooldownSec: 0 },
];

const cfg = { enabled: true, cooldownSec: 25, maxPerMinute: 2, rules };

test("los comandos no distinguen mayúsculas", () => {
  assert.equal(matchRule("!REDES", rules[0]), true);
  assert.equal(matchRule("!redes porfa", rules[0]), true);
  assert.equal(matchRule("redes", rules[0]), false);
});

test("contains y regex funcionan", () => {
  assert.equal(matchRule("buenas noches", rules[1]), true);
  assert.equal(matchRule("precio 25", rules[3]), true);
  assert.equal(matchRule("precio caro", rules[3]), false);
});

test("las reglas desactivadas no responden", () => {
  assert.equal(matchRule("test", rules[2]), false);
});

test("respeta el enfriamiento por usuario", () => {
  const state = createReplyState();
  const first = buildReply("!redes", cfg, state, "u1", 1000);
  const second = buildReply("!redes", cfg, state, "u1", 5000);
  const other = buildReply("!redes", cfg, state, "u2", 5000);
  assert.equal(first.response, "mis redes");
  assert.equal(second, null);
  assert.equal(other.response, "mis redes");
});

test("respeta el máximo por minuto", () => {
  const state = createReplyState();
  const now = 1000;
  assert.ok(pickRule("buenas", cfg, state, "a", now));
  registerReply(state, rules[1], "a", now);
  assert.ok(pickRule("buenas", cfg, state, "b", now));
  registerReply(state, rules[1], "b", now);
  assert.equal(pickRule("buenas", cfg, state, "c", now), null);
});

test("una regex inválida no rompe el bot", () => {
  assert.equal(matchRule("lo que sea", { enabled: true, match: "regex", pattern: "[" }), false);
});
