import test from "node:test";
import assert from "node:assert/strict";
import { createMinecraftBridge } from "../src/minecraft.js";
import { defaultConfig, normalizeConfig } from "../src/config.js";

test("Minecraft está desactivado por defecto y la opción se normaliza", () => {
  assert.deepEqual(defaultConfig().minecraft, { enabled: false, mobRules: [] });
  assert.deepEqual(normalizeConfig({ minecraft: { enabled: true } }).minecraft, { enabled: true, mobRules: [] });
});

test("la cola acepta solo mobs permitidos, sanea nombres y descarta acciones viejas", () => {
  const bridge = createMinecraftBridge();
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "cow" }, 10000), false);
  bridge.poll(10000);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "minecraft:command_block" }, 10001), false);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "cow", name: "Hola\n/op @a" }, 10002), true);
  assert.deepEqual(bridge.poll(10003), [{ type: "mob", mob: "cow", name: "Hola /op @a", count: 1 }]);
  assert.deepEqual(bridge.lastDelivery(), { action: "mob:cow", at: 10003 });
  bridge.enqueueMob({ type: "mob", mob: "pig" }, 10004);
  assert.deepEqual(bridge.poll(15005), []);
  bridge.poll(20000);
  for (let i = 0; i < 8; i++) bridge.enqueueMob({ type: "mob", mob: "bee" }, 20001 + i);
  assert.equal(bridge.poll(20010).length, 4);
});

test("la cola limita la cantidad por acción y por consulta del mod", () => {
  const bridge = createMinecraftBridge();
  bridge.poll(10000);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "creeper", count: 20 }, 10001), true);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "cow", count: 4 }, 10002), true);
  assert.deepEqual(bridge.poll(10003).map((action) => action.count), [20]);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "creeper", count: 3 }, 10004), true);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "cow", count: 4 }, 10005), true);
  assert.deepEqual(bridge.poll(10006).map((action) => action.count), [3, 4]);
});

test("la cola deja pasar hasta cinco jefes en total por consulta", () => {
  const bridge = createMinecraftBridge();
  bridge.poll(10000);
  bridge.enqueueMob({ type: "mob", mob: "wither", count: 3 }, 10001);
  bridge.enqueueMob({ type: "mob", mob: "warden", count: 5 }, 10002);
  assert.deepEqual(bridge.poll(10003).map((action) => [action.mob, action.count]), [["wither", 3], ["warden", 2]]);
});

test("la cola limita a veinte explosivos aparte de los veinte mobs", () => {
  const bridge = createMinecraftBridge();
  bridge.poll(10000);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "primed_tnt", count: 50 }, 10001), true);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "end_crystal_auto", count: 20 }, 10002), true);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "cow", count: 20 }, 10003), true);
  assert.deepEqual(bridge.poll(10004).map((action) => [action.mob, action.count]), [["primed_tnt", 20], ["cow", 20]]);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "end_crystal", count: 7 }, 10005), true);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "end_crystal_auto", count: 20 }, 10006), true);
  assert.deepEqual(bridge.poll(10007).map((action) => action.count), [7, 13]);
  assert.equal(bridge.enqueueMob({ type: "mob", mob: "summon", count: 1 }, 10008), false);
});

test("no se encolan acciones sin un mod que esté consultando Zhezhi", () => {
  const bridge = createMinecraftBridge();
  assert.equal(bridge.enqueue({ kind: "gift" }, 10000), false);
  assert.deepEqual(bridge.poll(10000), []);
  assert.equal(bridge.online(10001), true);
  assert.equal(bridge.enqueue({ kind: "gift" }, 16000), false);
  assert.deepEqual(bridge.poll(16000), []);
});

test("solo se devuelven acciones conocidas, recientes y limitadas", () => {
  const bridge = createMinecraftBridge();
  bridge.poll(10000);
  assert.equal(bridge.enqueue({ kind: "likes" }, 10001), true);
  assert.equal(bridge.enqueue({ kind: "gift" }, 10002), true);
  assert.equal(bridge.enqueue({ kind: "chat", text: "/op @a" }, 10003), false);
  assert.equal(bridge.enqueue({ kind: "vote", choice: "/op @a" }, 10003), false);
  assert.deepEqual(bridge.poll(10004), ["speed", "zombie"]);
  assert.deepEqual(bridge.lastDelivery(), { action: "zombie", at: 10004 });
  assert.deepEqual(bridge.poll(10005), []);
  bridge.enqueue({ kind: "likes" }, 10006);
  assert.deepEqual(bridge.poll(16007), []);
});

test("el voto puede cambiar día o noche con enfriamiento y la pausa limpia la cola", () => {
  const bridge = createMinecraftBridge();
  bridge.poll(40000);
  assert.equal(bridge.enqueue({ kind: "vote", choice: "a" }, 40001), true);
  assert.equal(bridge.enqueue({ kind: "vote", choice: "b" }, 40002), false);
  assert.deepEqual(bridge.poll(40003), ["day"]);
  assert.equal(bridge.enqueue({ kind: "vote", choice: "b" }, 70002), false);
  bridge.poll(70002);
  assert.equal(bridge.enqueue({ kind: "vote", choice: "b" }, 70003), true);
  assert.deepEqual(bridge.poll(70004), ["night"]);
  bridge.enqueue({ kind: "gift" }, 70005);
  bridge.clear();
  assert.equal(bridge.lastDelivery(), null);
  assert.deepEqual(bridge.poll(70006), []);
});
