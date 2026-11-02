import test from "node:test";
import assert from "node:assert/strict";
import { VoiceEngine } from "../src/tts.js";

test("prioriza avisos y reemplaza los comentarios pendientes por el más reciente", async () => {
  const voice = new VoiceEngine({ dir: "", log: () => {} });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const heard = [];
  voice.synthesize = async (text) => {
    if (text === "en curso") await gate;
    return { text };
  };
  const add = (text, kind) => voice.enqueue(text, { minIntervalMs: 0 }, (result) => heard.push(result.text), null, { kind, maxQueue: 3 });
  add("en curso", "chat");
  add("antiguo", "chat");
  add("nuevo", "chat");
  add("suscripción", "subscribe");
  assert.deepEqual(voice.queue.map((job) => job.text), ["suscripción", "nuevo"]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(heard, ["en curso", "suscripción", "nuevo"]);
  voice.stop();
});

test("descarta un chat antiguo antes de generarlo", async () => {
  const voice = new VoiceEngine({ dir: "", log: () => {} });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const heard = [];
  voice.synthesize = async (text) => {
    if (text === "en curso") await gate;
    return { text };
  };
  voice.enqueue("en curso", {}, (result) => heard.push(result.text), null, { kind: "subscribe" });
  voice.enqueue("chat viejo", {}, (result) => heard.push(result.text), null, { kind: "chat" });
  voice.queue[0].createdAt = Date.now() - 30000;
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(heard, ["en curso"]);
  voice.stop();
});

test("las bienvenidas pendientes no se acumulan ni se leen fuera de tiempo", async () => {
  const voice = new VoiceEngine({ dir: "", log: () => {} });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const heard = [];
  voice.synthesize = async (text) => {
    if (text === "en curso") await gate;
    return { text };
  };
  voice.enqueue("en curso", {}, (result) => heard.push(result.text), null, { kind: "gift" });
  voice.enqueue("Bienvenido, Ana", {}, (result) => heard.push(result.text), null, { kind: "join" });
  voice.enqueue("Bienvenido, Luna", {}, (result) => heard.push(result.text), null, { kind: "join" });
  assert.deepEqual(voice.queue.map((job) => job.text), ["Bienvenido, Luna"]);
  voice.queue[0].createdAt = Date.now() - 30_000;
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(heard, ["en curso"]);
  voice.stop();
});
