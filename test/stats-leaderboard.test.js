import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, createStats, statsSnapshot } from "../src/stats.js";

test("ordena los likes por persona sin asignar el total del LIVE a un espectador", () => {
  const stats = createStats();
  applyEvent(stats, { kind: "like", total: 1000, count: 0 });
  applyEvent(stats, { kind: "like", total: 1005, count: 5, user: { id: "1", name: "Luna", avatar: "https://example.com/luna.png" } });
  applyEvent(stats, { kind: "like", total: 1017, count: 12, user: { id: "2", name: "Óscar" } });
  applyEvent(stats, { kind: "like", total: 1020, count: 3, user: { id: "1", name: "Luna nueva" } });
  const snapshot = statsSnapshot(stats);
  assert.equal(snapshot.likes, 1020);
  assert.deepEqual(snapshot.topLikers, [
    { name: "Óscar", avatar: "", count: 12 },
    { name: "Luna nueva", avatar: "https://example.com/luna.png", count: 8 },
  ]);
});

test("cuenta solo el incremento si TikTok no incluye count; ignora identidades desconocidas", () => {
  const stats = createStats();
  applyEvent(stats, { kind: "like", total: 600, count: 0, user: { name: "Luna" } });
  assert.deepEqual(statsSnapshot(stats).topLikers, []);
  applyEvent(stats, { kind: "like", total: 606, user: { name: "Luna" } });
  applyEvent(stats, { kind: "like", total: 610, count: 4 });
  assert.deepEqual(statsSnapshot(stats).topLikers, [{ name: "Luna", avatar: "", count: 6 }]);
});

test("suma diamantes por usuario, no mezcla apodos iguales y se reinicia por sesión", () => {
  const stats = createStats();
  applyEvent(stats, { kind: "gift", diamonds: 12, user: { id: "1", name: "Luna", avatar: "https://example.com/a.png" } });
  applyEvent(stats, { kind: "gift", diamonds: 4, user: { id: "1", name: "Luna" } });
  applyEvent(stats, { kind: "gift", diamonds: 9, user: { id: "2", name: "Luna" } });
  assert.deepEqual(statsSnapshot(stats).topGifters, [
    { name: "Luna", avatar: "https://example.com/a.png", diamonds: 16, count: 2 },
    { name: "Luna", avatar: "", diamonds: 9, count: 1 },
  ]);
  assert.deepEqual(statsSnapshot(createStats()).topGifters, []);
  assert.deepEqual(statsSnapshot(createStats()).topLikers, []);
});
