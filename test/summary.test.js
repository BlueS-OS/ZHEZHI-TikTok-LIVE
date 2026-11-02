import test from "node:test";
import assert from "node:assert/strict";
import { buildSummary } from "../src/summary.js";

const now = 1_700_000_000_000;

const events = [
  { at: now - 60_000, kind: "chat", hidden: false, user: { name: "Ana" }, text: "hola, ¿de dónde eres?" },
  { at: now - 50_000, kind: "chat", hidden: false, user: { name: "Luis" }, text: "hola que tal el directo" },
  { at: now - 40_000, kind: "chat", hidden: true, user: { name: "Spam" }, text: "ESTAFA" },
  { at: now - 30_000, kind: "gift", user: { name: "Ana" }, diamonds: 100, gift: { name: "León" } },
  { at: now - 20_000, kind: "follow", user: { name: "Kira" } },
  { at: now - 10_000, kind: "chat", hidden: false, user: { name: "Luis" }, text: "¿juegas ranked hoy?" },
  { at: now - 20 * 60_000, kind: "chat", hidden: false, user: { name: "Viejo" }, text: "fuera de ventana" },
];

test("cuenta solo la ventana y separa los ocultos", () => {
  const summary = buildSummary(events, { now, windowMinutes: 10 });
  assert.equal(summary.totals.messages, 4);
  assert.equal(summary.totals.hidden, 1);
  assert.equal(summary.totals.activeUsers, 2);
  assert.equal(summary.totals.follows, 1);
  assert.equal(summary.totals.diamonds, 100);
});

test("detecta preguntas y ordena usuarios", () => {
  const summary = buildSummary(events, { now, windowMinutes: 10 });
  assert.equal(summary.questions.length, 2);
  assert.equal(summary.topChatters[0].name, "Luis");
  assert.equal(summary.topGifters[0].name, "Ana");
});

test("no repite la misma pregunta", () => {
  const repeated = [
    { at: now - 1000, kind: "chat", hidden: false, user: { name: "Ana" }, text: "¿qué juego?" },
    { at: now - 900, kind: "chat", hidden: false, user: { name: "Luis" }, text: "¿Qué juego?" },
  ];
  const summary = buildSummary(repeated, { now, windowMinutes: 5 });
  assert.equal(summary.questions.length, 1);
});
