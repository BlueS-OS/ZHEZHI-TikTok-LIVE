import test from "node:test";
import assert from "node:assert/strict";
import { createInteractions, applyInteraction, interactionSnapshot } from "../src/interactions.js";
import { defaultConfig, normalizeConfig } from "../src/config.js";

const options = { enabled: true, likes: true, likesStep: 50, gifts: true, giftMin: 100, comments: true };

test("las interacciones están apagadas por defecto y se normalizan los límites", () => {
  assert.equal(defaultConfig().interactions.enabled, false);
  const normalized = normalizeConfig({ interactions: { enabled: true, likesStep: -4, giftMin: 999999, optionA: "x".repeat(70) } });
  assert.equal(normalized.interactions.likesStep, 1);
  assert.equal(normalized.interactions.giftMin, 100000);
  assert.ok(normalized.interactions.optionA.length <= 24);
  assert.equal(applyInteraction(createInteractions(), { kind: "like", count: 100 }, defaultConfig().interactions), null);
});

test("likes agregados disparan como máximo un efecto cada ocho segundos", () => {
  const state = createInteractions();
  assert.equal(applyInteraction(state, { kind: "like", count: 25 }, options, 10000), null);
  assert.equal(applyInteraction(state, { kind: "like", count: 25, user: { name: "Luna" } }, options, 10001)?.name, "Luna");
  assert.equal(applyInteraction(state, { kind: "like", count: 50 }, options, 10002), null);
  assert.equal(applyInteraction(state, { kind: "like", count: 1 }, options, 19000)?.kind, "likes");
  assert.equal(applyInteraction(state, { kind: "like", count: 0 }, options, 28000), null);
});

test("regalos tienen umbral propio y enfriamiento", () => {
  const state = createInteractions();
  assert.equal(applyInteraction(state, { kind: "gift", diamonds: 99 }, options, 10000), null);
  assert.equal(applyInteraction(state, { kind: "gift", diamonds: 100 }, options, 10000)?.kind, "gift");
  assert.equal(applyInteraction(state, { kind: "gift", diamonds: 200 }, options, 10001), null);
  assert.equal(applyInteraction(state, { kind: "gift", diamonds: 200 }, options, 18000)?.kind, "gift");
});

test("cada persona tiene un voto; puede cambiarlo, mensajes ocultos no cuentan", () => {
  const state = createInteractions();
  const chat = (id, text, extra = {}) => ({ kind: "chat", user: { id }, text, ...extra });
  assert.equal(applyInteraction(state, chat("1", "!a", { hidden: true }), options), null);
  assert.equal(applyInteraction(state, chat("1", "!a"), options)?.votes.a, 1);
  assert.equal(applyInteraction(state, chat("1", "!a"), options), null);
  assert.equal(applyInteraction(state, chat("2", "!b"), options)?.votes.b, 1);
  assert.deepEqual(applyInteraction(state, chat("1", "!B"), options)?.votes, { a: 0, b: 2 });
  assert.equal(applyInteraction(state, chat("", "!a"), options), null);
  assert.equal(applyInteraction(state, chat("3", "!a extra"), options), null);
  assert.deepEqual(interactionSnapshot(createInteractions()), { a: 0, b: 0 });
});
