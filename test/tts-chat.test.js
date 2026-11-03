import test from "node:test";
import assert from "node:assert/strict";
import { chatSpeechText, cleanForSpeech } from "../src/tts.js";

test("lee el comentario completo junto al nombre", () => {
  const event = { user: { name: "Luna" }, text: "saluda a la luna porfa" };
  assert.equal(chatSpeechText(event, { readNickname: true, maxChars: 120 }), "Luna dice: saluda a la luna porfa");
  assert.equal(chatSpeechText(event, { readNickname: false, maxChars: 120 }), "saluda a la luna porfa");
});

test("no lee solo el nombre cuando el comentario no tiene texto pronunciable", () => {
  const event = { user: { name: "Luna" }, text: "💀💀💀" };
  assert.equal(chatSpeechText(event), "");
  assert.equal(chatSpeechText({ ...event, text: "https://example.com" }), "");
  assert.equal(chatSpeechText({ ...event, text: "!!!" }), "");
});

test("las menciones conservan el nombre y los apodos largos no tapan el comentario", () => {
  assert.equal(cleanForSpeech("saluda a @luna_91 porfa"), "saluda a luna_91 porfa");
  const spoken = chatSpeechText({ user: { name: "un nombre de usuario larguísimo que ocupa todo" }, text: "hola" }, { maxChars: 40 });
  assert.match(spoken, /dice: hola$/);
  assert.ok(spoken.length <= 40);
});
