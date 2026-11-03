import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig } from "../src/config.js";
import { socialAnnouncement } from "../src/voice-announcements.js";

test("las lecturas de me gusta y bienvenida están apagadas por defecto y son independientes", () => {
  const defaults = normalizeConfig({});
  assert.equal(defaults.tts.readLikes, false);
  assert.equal(defaults.tts.readJoins, false);
  assert.equal(normalizeConfig({ tts: { readLikes: true } }).tts.readJoins, false);
  assert.equal(normalizeConfig({ tts: { readJoins: true } }).tts.readLikes, false);
});

test("la voz dice el nombre del usuario sin confundir entrada con me gusta", () => {
  const user = { name: "Luna" };
  assert.equal(socialAnnouncement({ kind: "join", user }), "Bienvenido, Luna");
  assert.equal(socialAnnouncement({ kind: "like", user }), "Luna le dio me gusta al directo");
  assert.equal(socialAnnouncement({ kind: "gift", user }), "");
});
